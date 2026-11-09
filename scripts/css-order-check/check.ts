// Usage: bun scripts/css-order-check/check.ts <bun-binary> [case-name-filter]
// For each case: the computed color of each probe element from the source files and from the bundle,
// under screen and print. "EXT/" in a file is the origin of the external style sheets.
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { Chrome } from "./cdp.ts";
import { cases } from "./cases.ts";

const bunBin = process.argv[2];
const filter = process.argv[3];
if (!bunBin) throw new Error("usage: check.ts <bun-binary> [filter]");

const root = "/tmp/css-order-check/work-" + process.pid;
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

const externals = new Map<string, string>();
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/ext/")) {
      const body = externals.get(url.pathname);
      if (body === undefined) return new Response("not found", { status: 404 });
      return new Response(body, { headers: { "content-type": "text/css" } });
    }
    const path = join(root, url.pathname);
    if (!existsSync(path)) return new Response("not found", { status: 404 });
    const type = path.endsWith(".css")
      ? "text/css"
      : path.endsWith(".html")
        ? "text/html"
        : path.endsWith(".svg")
          ? "image/svg+xml"
          : "application/octet-stream";
    return new Response(readFileSync(path), { headers: { "content-type": type } });
  },
});
const origin = `http://127.0.0.1:${server.port}`;

const chrome = await Chrome.launch();
const medias = ["screen", "print"];
let failures = 0;
const rows: string[] = [];
for (const [name, c] of Object.entries(cases)) {
  if (filter && !name.includes(filter)) continue;
  const dir = join(root, name);
  const ext = `${origin}/ext/${name}/`;
  for (const [file, content] of Object.entries(c.files)) {
    const path = join(dir, "src", file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content.replaceAll("EXT/", ext));
  }
  for (const [file, content] of Object.entries(c.external ?? {})) externals.set(`/ext/${name}/${file}`, content);
  const probes = c.probes ?? ["t"];
  const html = (href: string) =>
    `<!doctype html><link rel="stylesheet" href="${href}">` + probes.map(p => `<div class="${p}">${p}</div>`).join("");
  writeFileSync(join(dir, "source.html"), html("src/entry.css"));
  writeFileSync(join(dir, "bundle.html"), html("out/entry.css"));
  const build = Bun.spawnSync({
    cmd: [bunBin, "build", "./entry.css", "--outdir", join(dir, "out"), ...(c.args ?? ["--minify-whitespace"])],
    cwd: join(dir, "src"),
    env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = build.stderr.toString().trim();
  if (build.exitCode !== 0 || !existsSync(join(dir, "out", "entry.css"))) {
    rows.push(`${name}: BUILD FAILED (exit ${build.exitCode})\n    ${stderr.split("\n").join("\n    ")}`);
    if (!c.expectBuildError) failures++;
    continue;
  }
  const bundleText = readFileSync(join(dir, "out", "entry.css"), "utf8").replaceAll(ext, "EXT/");
  const expr = `JSON.stringify(Object.fromEntries(${JSON.stringify(probes)}.map(p => [p, getComputedStyle(document.querySelector("." + p)).color])))`;
  let line = `${name}:`;
  let ok = true;
  for (const media of medias) {
    const src = JSON.parse(await chrome.evaluate(`${origin}/${name}/source.html`, media, expr));
    const out = JSON.parse(await chrome.evaluate(`${origin}/${name}/bundle.html`, media, expr));
    const same = JSON.stringify(src) === JSON.stringify(out);
    ok &&= same;
    const short = (o: Record<string, string>) =>
      Object.entries(o)
        .map(([k, v]) => `${k}=${colorName(v)}`)
        .join(",");
    line += `  [${media}] source ${short(src)} bundle ${short(out)} ${same ? "OK" : "DIFFERENT"}`;
  }
  if (!ok) failures++;
  rows.push(line + (stderr ? `\n    stderr: ${stderr.split("\n").join("\n    ")}` : "") + `\n    bundle: ${bundleText.trim().split("\n").join("\n            ")}`);
}
function colorName(v: string) {
  return (
    { "rgb(255, 0, 0)": "red", "rgb(0, 128, 0)": "green", "rgb(0, 0, 255)": "blue", "rgb(0, 0, 0)": "black", "rgb(255, 165, 0)": "orange", "rgb(128, 0, 128)": "purple" }[v] ?? v
  );
}
console.log(rows.join("\n"));
console.log(failures === 0 ? "\nALL SAME" : `\n${failures} case(s) differ`);
await chrome.close();
server.stop(true);
rmSync(root, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
