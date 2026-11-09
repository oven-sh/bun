// bun scripts/css-order-check/chrome-validate.ts <bun> <graphs> [first seed] [--flags as fuzz.ts]
// Checks the model against Chrome: the winner of `--k` for `.t` from the source files and from the bundle.
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Chrome } from "./cdp.ts";
import { generateGraph, type GraphOptions } from "./generate.ts";
import { evaluate } from "./model.ts";

const flagNames: Record<string, keyof GraphOptions> = {
  "--cycles": "cycles",
  "--anonymous": "anonymous",
  "--empty-blocks": "emptyBlocks",
  "--conditions": "conditions",
  "--import-conditions": "importConditions",
  "--external": "external",
  "--external-rules": "externalRules",
  "--assets": "assets",
  "--anon-blocks": "anonBlocks",
  "--empty-files": "emptyFiles",
};
const flags = process.argv.slice(2).filter(a => a.startsWith("--"));
const [bun, count = "20", first = "1"] = process.argv.slice(2).filter(a => !a.startsWith("--"));
const options: GraphOptions = { leadingStatements: true };
for (const [flag, key] of Object.entries(flagNames)) if (flags.includes(flag) || flags.includes("--all")) options[key] = true;

const root = "/tmp/css-order-check/fuzz-" + process.pid;
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
const externalText = (name: string) => (options.externalRules ? `.t { --k: ${name} }` : "");
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const url = new URL(req.url);
    const ext = /^\/ext\/(e\d+)\.css$/.exec(url.pathname);
    if (ext) return new Response(externalText(ext[1]), { headers: { "content-type": "text/css" } });
    const path = join(root, url.pathname);
    if (!existsSync(path)) return new Response("not found", { status: 404 });
    const type = path.endsWith(".css") ? "text/css" : path.endsWith(".html") ? "text/html" : "image/svg+xml";
    return new Response(readFileSync(path), { headers: { "content-type": type } });
  },
});
const origin = `http://127.0.0.1:${server.port}`;
// The model keys: m1 = wide viewport, m2 = tall viewport, s1 holds, s2 does not.
const translate = (css: string) =>
  css
    .replaceAll("https://example.com/", origin + "/ext/")
    .replaceAll("min-width: 1px", "min-width: 1000px")
    .replaceAll("min-width: 2px", "min-height: 1000px")
    .replaceAll("top: 2px", "bogus-prop: 2px");
const stateOf = (wide: boolean, tall: boolean) => {
  const s = new Set<string>(["s1"]);
  if (wide) s.add("m1");
  if (tall) s.add("m2");
  return s;
};
// The model reads the untranslated text, so translate the bundle back.
const untranslate = (css: string) =>
  css
    .replaceAll(origin + "/ext/", "https://example.com/")
    .replace(/min-width:\s*1000px/g, "min-width: 1px")
    .replace(/min-height:\s*1000px/g, "min-width: 2px")
    .replace(/bogus-prop:\s*2px/g, "top: 2px");

const chrome = await Chrome.launch();
let mismatches = 0;
let checked = 0;
const expr = `getComputedStyle(document.querySelector(".t")).getPropertyValue("--k").trim()`;
for (let seed = Number(first); seed < Number(first) + Number(count); seed++) {
  const { files, entry } = generateGraph(seed, options);
  const dir = join(root, String(seed));
  mkdirSync(join(dir, "src"), { recursive: true });
  for (const [name, css] of Object.entries(files)) writeFileSync(join(dir, "src", name), name.endsWith(".css") ? translate(css) : css);
  const html = (href: string) => `<!doctype html><link rel="stylesheet" href="${href}"><div class="t">t</div>`;
  writeFileSync(join(dir, "source.html"), html("src/entry.css"));
  writeFileSync(join(dir, "bundle.html"), html("out/entry.css"));
  const build = Bun.spawnSync({
    cmd: [bun, "build", "./" + entry, "--outdir", join(dir, "out"), "--minify"],
    cwd: join(dir, "src"),
    env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const built = build.exitCode === 0 && existsSync(join(dir, "out", "entry.css"));
  const bundle = built ? untranslate(readFileSync(join(dir, "out", "entry.css"), "utf8")) : "";
  const external = (url: string) => {
    const name = /\/(e\d+)\.css$/.exec(url)?.[1];
    return name ? externalText(name) : undefined;
  };
  for (const [wide, tall] of [[true, true], [true, false], [false, true], [false, false]] as const) {
    const viewport = { width: wide ? 1200 : 500, height: tall ? 1200 : 500 };
    const state = stateOf(wide, tall);
    const modelSource = evaluate(files, entry, state, external).normal.at(-1) ?? "";
    const chromeSource = await chrome.evaluate(`${origin}/${seed}/source.html`, "screen", expr, viewport);
    checked++;
    if (modelSource !== chromeSource) {
      mismatches++;
      console.log(`seed ${seed} SOURCE state ${[...state].join(" ")}: model ${modelSource}, chrome ${chromeSource}`);
    }
    if (built) {
      const modelBundle = evaluate({ "bundle.css": bundle }, "bundle.css", state, external).normal.at(-1) ?? "";
      const chromeBundle = await chrome.evaluate(`${origin}/${seed}/bundle.html`, "screen", expr, viewport);
      checked++;
      if (modelBundle !== chromeBundle) {
        mismatches++;
        console.log(`seed ${seed} BUNDLE state ${[...state].join(" ")}: model ${modelBundle}, chrome ${chromeBundle}\n   ${bundle.trim().slice(0, 600)}`);
      }
    }
  }
}
console.log(`${checked} evaluations, ${mismatches} where the model and Chrome differ`);
await chrome.close();
server.stop(true);
rmSync(root, { recursive: true, force: true });
process.exit(mismatches ? 1 : 0);
