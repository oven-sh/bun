// JSX configuration output matrix.
//
// usage: bun matrix.ts <target-bun> <out.jsonl> [--conc=N] [--only=<entry,entry>] [--root=<dir>]
//
// For every combination of tsconfig.json state, bunfig.toml state, --jsx-* flags (or
// Bun.build({jsx}) variant), NODE_ENV and entry point, run ONE process of <target-bun>
// and record what JSX it compiled to. One JSON object per line: { key, out, code }.
// Two binaries are compared by diffing their files (see diff.py).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [target, outFile, ...rest] = process.argv.slice(2);
if (!target || !outFile) {
  console.error("usage: bun matrix.ts <target-bun> <out.jsonl> [--conc=N] [--only=a,b] [--root=dir]");
  process.exit(2);
}
const opt = (name: string) => rest.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const conc = Number(opt("conc") ?? 8);
const only = opt("only")?.split(",");
const root = opt("root") ?? "/workspace/jsx-matrix/fx";

const TS: Record<string, object | null> = {
  "none": null,
  "empty": { compilerOptions: {} },
  "react-jsx": { compilerOptions: { jsx: "react-jsx" } },
  "react-jsxdev": { compilerOptions: { jsx: "react-jsxdev" } },
  "classic-th": { compilerOptions: { jsx: "react", jsxFactory: "th", jsxFragmentFactory: "thf" } },
  "src-tsrc": { compilerOptions: { jsx: "react-jsx", jsxImportSource: "tsrc" } },
  "only-src-tsrc": { compilerOptions: { jsxImportSource: "tsrc" } },
};
const BF: Record<string, string | null> = {
  "none": null,
  "nojsx": "[install]\nsaveTextLockfile = true\n",
  "classic-bh": 'jsx = "react"\njsxFactory = "bh"\njsxFragment = "bhf"\n',
  "react-jsx": 'jsx = "react-jsx"\n',
  "react-jsxDEV": 'jsx = "react-jsxDEV"\n',
  "src-bsrc": 'jsxImportSource = "bsrc"\n',
};
const FL: Record<string, string[]> = {
  "none": [],
  "classic-fh": ["--jsx-runtime=classic", "--jsx-factory=fh", "--jsx-fragment=fhf"],
  "src-fsrc": ["--jsx-import-source=fsrc"],
  "automatic": ["--jsx-runtime=automatic"],
  "side-effects": ["--jsx-side-effects"],
};
// Bun.build({ jsx }) variants. "none" passes no jsx key at all.
const API: Record<string, object | undefined> = {
  "none": undefined,
  "empty": {},
  "classic-ah": { runtime: "classic", factory: "ah", fragment: "ahf" },
  "src-asrc": { importSource: "asrc" },
  "dev-true": { development: true },
  "dev-false": { development: false },
  "automatic": { runtime: "automatic" },
};
const ENV = ["unset", "production", "development"];

const PKGS = ["react", "tsrc", "bsrc", "fsrc", "asrc"];
const FACTORIES = [
  ["th", "thf"],
  ["bh", "bhf"],
  ["fh", "fhf"],
  ["ah", "ahf"],
];

// A "key" after a spread is compiled to createElement, imported from the package of the import source.
const buildEntry = `export const el = <div className="a">x</div>;
export const frag = <><i /></>;
const props = {};
export const keyed = <u {...props} key="k" />;
<b />;
`;
const runtimeBody = `const mark = (s: string) => console.log(s);
(globalThis as any).React = {
  createElement: (t: any) => (mark("classic:React.createElement:" + String(t)), {}),
  Fragment: "React.Fragment",
};
for (const [f, g] of ${JSON.stringify(FACTORIES)}) {
  (globalThis as any)[f] = (t: any) => (mark("classic:" + f + ":" + String(t)), {});
  (globalThis as any)[g] = g;
}
function render() {
  const props = {};
  return [<div className="a">x</div>, <><i /></>, <u {...props} key="k" />];
}
`;

function makeFixture(ts: string, bf: string): string {
  const dir = join(root, `${ts}__${bf}`);
  rmSync(dir, { recursive: true, force: true });
  for (const pkg of PKGS) {
    const p = join(dir, "node_modules", pkg);
    mkdirSync(p, { recursive: true });
    writeFileSync(
      join(p, "package.json"),
      JSON.stringify({
        name: pkg,
        version: "1.0.0",
        type: "module",
        exports: { ".": "./index.js", "./jsx-runtime": "./p.js", "./jsx-dev-runtime": "./d.js" },
      }),
    );
    writeFileSync(
      join(p, "index.js"),
      `export const createElement = t => (console.log("classic-import:${pkg}.createElement:" + String(t)), {});\nexport const Fragment = "${pkg}.Fragment";\nexport default { createElement, Fragment };\n`,
    );
    writeFileSync(
      join(p, "p.js"),
      `export const jsx = t => (console.log("auto:${pkg}:jsx:" + String(t)), {});\nexport const jsxs = jsx;\nexport const Fragment = "${pkg}:F";\n`,
    );
    writeFileSync(
      join(p, "d.js"),
      `export const jsxDEV = t => (console.log("auto:${pkg}:jsxDEV:" + String(t)), {});\nexport const Fragment = "${pkg}:F";\n`,
    );
  }
  if (TS[ts]) writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(TS[ts]));
  if (BF[bf] != null) writeFileSync(join(dir, "bunfig.toml"), BF[bf]!);
  writeFileSync(join(dir, "index.tsx"), buildEntry);
  writeFileSync(join(dir, "run.tsx"), runtimeBody + "render();\n");
  writeFileSync(
    join(dir, "a.test.tsx"),
    `import { test } from "bun:test";\n` + runtimeBody + `test("t", () => {\n  render();\n});\n`,
  );
  writeFileSync(
    join(dir, "build.ts"),
    `const variants: Record<string, any> = ${JSON.stringify(API)};
const v = process.env.JSX_VARIANT!;
const cfg: any = { entrypoints: ["./index.tsx"], packages: "external", throw: false };
if (v !== "none") cfg.jsx = variants[v];
const r = await Bun.build(cfg);
if (!r.success) {
  for (const l of r.logs) console.log("BUILD-ERROR: " + String(l.message ?? l));
  process.exit(1);
}
for (const o of r.outputs) console.log(await o.text());
`,
  );
  return dir;
}

type Cell = { key: string; cwd: string; cmd: string[]; env: Record<string, string>; kind: "text" | "marks" };

const cells: Cell[] = [];
for (const ts of Object.keys(TS)) {
  for (const bf of Object.keys(BF)) {
    const cwd = makeFixture(ts, bf);
    for (const ne of ENV) {
      const env: Record<string, string> = {};
      if (ne !== "unset") env.NODE_ENV = ne;
      for (const fl of Object.keys(FL)) {
        const flags = FL[fl];
        const add = (entry: string, cmd: string[], kind: Cell["kind"]) => {
          if (only && !only.includes(entry)) return;
          cells.push({ key: `${ts}|${bf}|${fl}|${ne}|${entry}`, cwd, cmd, env, kind });
        };
        add("build", [target, "build", "./index.tsx", "--packages=external", ...flags], "text");
        add("build-env", [target, "build", "./index.tsx", "--packages=external", "--env=inline", ...flags], "text");
        add("no-bundle", [target, "build", "--no-bundle", "./index.tsx", ...flags], "text");
        add("run-file", [target, ...flags, "./run.tsx"], "marks");
        add("run-run", [target, "run", ...flags, "./run.tsx"], "marks");
        add("test", [target, "test", ...flags, "./a.test.tsx"], "marks");
      }
      for (const v of Object.keys(API)) {
        const entry = `api-${v}`;
        if (only && !only.includes(entry) && !only.includes("api")) continue;
        cells.push({
          key: `${ts}|${bf}|-|${ne}|${entry}`,
          cwd,
          cmd: [target, "./build.ts"],
          env: { ...env, JSX_VARIANT: v },
          kind: "text",
        });
      }
    }
  }
}

const baseEnv: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v == null) continue;
  if (k === "NODE_ENV" || k === "BUN_ENV" || k.startsWith("BUN_DEBUG") || k === "JSX_VARIANT") continue;
  baseEnv[k] = v;
}
baseEnv.BUN_DEBUG_QUIET_LOGS = "1";
baseEnv.NO_COLOR = "1";
baseEnv.BUN_RUNTIME_TRANSPILER_CACHE_PATH = "0";

async function runCell(c: Cell) {
  const proc = Bun.spawn({ cmd: c.cmd, cwd: c.cwd, env: { ...baseEnv, ...c.env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let out: string;
  if (c.kind === "marks") {
    out = (stdout + "\n" + stderr)
      .split("\n")
      .filter(l => l.startsWith("classic") || l.startsWith("auto:"))
      .join(";");
  } else {
    out = stdout.replaceAll(c.cwd, "<dir>").trim();
  }
  if (code !== 0 || out === "") {
    const firstErr = (stderr + "\n" + stdout)
      .split("\n")
      .map(l => l.replaceAll(c.cwd, "<dir>").trim())
      .find(l => /error|panic|cannot find|could not/i.test(l));
    out = `EXIT ${code}: ${firstErr ?? ""} | ${out}`;
  }
  return { key: c.key, out, code };
}

const results: { key: string; out: string; code: number }[] = new Array(cells.length);
let next = 0;
const started = performance.now();
await Promise.all(
  Array.from({ length: conc }, async () => {
    while (next < cells.length) {
      const i = next++;
      results[i] = await runCell(cells[i]);
    }
  }),
);
writeFileSync(outFile, results.map(r => JSON.stringify(r)).join("\n") + "\n");
console.log(`${cells.length} cells in ${((performance.now() - started) / 1000).toFixed(1)}s -> ${outFile}`);
