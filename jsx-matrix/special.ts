// JSX configuration output matrix, part 2: layouts with more than one tsconfig.json and entry points
// that matrix.ts does not reach.
//
// usage: bun special.ts <target-bun> <out.jsonl> [--conc=N] [--root=<dir>] [--twin]
//
//   N  a nested tsconfig.json (pkg/) under the one of the working directory
//   X  a tsconfig.json that extends another
//   O  --tsconfig-override
//   M  a package in node_modules with its own tsconfig.json
//   T  Bun.Transpiler({ tsconfig })
//   W  a Worker
//   V  Bun.build with a file in memory and a module of a plugin
//   E  a tsconfig.json below that extends the one of the project, and one that extends the same base file
//
// --twin: write the tsconfig.json of the project without the options that the user's sources of the cell state.
// What main prints beside those files is what a build with the new rule must print beside the real ones.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [target, outFile, ...rest] = process.argv.slice(2);
if (!target || !outFile) {
  console.error("usage: bun special.ts <target-bun> <out.jsonl> [--conc=N] [--root=dir] [--twin]");
  process.exit(2);
}
const opt = (name: string) => rest.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const conc = Number(opt("conc") ?? 8);
const root = opt("root") ?? "/workspace/jsx-matrix/fx-special";
const twin = rest.includes("--twin");

const BF: Record<string, string | null> = {
  "none": null,
  "nojsx": "[install]\nsaveTextLockfile = true\n",
  "classic-bh": 'jsx = "react"\njsxFactory = "bh"\njsxFragment = "bhf"\n',
  "react-jsxDEV": 'jsx = "react-jsxDEV"\n',
  "src-bsrc": 'jsxImportSource = "bsrc"\n',
};
const FL: Record<string, string[]> = {
  "none": [],
  "classic-fh": ["--jsx-runtime=classic", "--jsx-factory=fh", "--jsx-fragment=fhf"],
  "src-fsrc": ["--jsx-import-source=fsrc"],
};
const ENV = ["unset", "production"];
const PKGS = ["react", "tsrc", "bsrc", "fsrc", "asrc"];
const EXTERNAL = PKGS.flatMap(pkg => ["--external", pkg, "--external", `${pkg}/*`]);
const FACTORIES = [
  ["th", "thf"],
  ["th2", "thf2"],
  ["bh", "bhf"],
  ["fh", "fhf"],
  ["ah", "ahf"],
];

// What a source states: the runtime, and whether it states development, the factories, the import source.
type States = { runtime?: "A" | "C"; development?: boolean; factory?: boolean; importSource?: boolean };
const BF_STATES: Record<string, States> = {
  "classic-bh": { runtime: "C", factory: true },
  "react-jsxDEV": { runtime: "A", development: true },
  "src-bsrc": { importSource: true },
};
const FL_STATES: Record<string, States> = {
  "classic-fh": { runtime: "C", factory: true },
  "src-fsrc": { importSource: true },
};
const API_STATES: Record<string, States> = {
  "classic-ah": { runtime: "C", factory: true },
  "src-asrc": { importSource: true },
};
function userStates(bf: string, fl: string): States {
  const b = BF_STATES[bf] ?? {};
  const f = FL_STATES[fl] ?? {};
  return {
    runtime: f.runtime ?? b.runtime,
    // a valued flag brings its own development default
    development: b.development && !(fl in FL_STATES),
    factory: b.factory || f.factory,
    importSource: b.importSource || f.importSource,
  };
}
// The tsconfig text that is left beside a user who states `u`.
function left(json: string, u: States): string {
  if (!twin) return json;
  const config = JSON.parse(json);
  const co = config.compilerOptions ?? {};
  // "jsx" states the runtime and, as react-jsx or react-jsxdev, development. Under a stated classic runtime
  // development changes no output, so the key goes as a whole.
  if (u.runtime && (u.development || u.runtime === "C" || co.jsx === "react")) delete co.jsx;
  if (u.factory) {
    delete co.jsxFactory;
    delete co.jsxFragmentFactory;
  }
  if (u.importSource) delete co.jsxImportSource;
  return JSON.stringify(config);
}

function write(dir: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    const path = join(dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
}
function stubs(dir: string) {
  for (const pkg of PKGS) {
    write(join(dir, "node_modules", pkg), {
      "package.json": JSON.stringify({
        name: pkg,
        version: "1.0.0",
        type: "module",
        exports: { ".": "./index.js", "./jsx-runtime": "./p.js", "./jsx-dev-runtime": "./d.js" },
      }),
      "index.js": `export const createElement = t => (console.log("classic-import:${pkg}.createElement:" + String(t)), {});\nexport const Fragment = "${pkg}.Fragment";\nexport default { createElement, Fragment };\n`,
      "p.js": `export const jsx = t => (console.log("auto:${pkg}:jsx:" + String(t)), {});\nexport const jsxs = jsx;\nexport const Fragment = "${pkg}:F";\n`,
      "d.js": `export const jsxDEV = t => (console.log("auto:${pkg}:jsxDEV:" + String(t)), {});\nexport const Fragment = "${pkg}:F";\n`,
    });
  }
}
const globalsSrc = `const mark = (s: string) => console.log(s);
(globalThis as any).React = {
  createElement: (t: any) => (mark("classic:React.createElement:" + String(t)), {}),
  Fragment: "React.Fragment",
};
for (const [f, g] of ${JSON.stringify(FACTORIES)}) {
  (globalThis as any)[f] = (t: any) => (mark("classic:" + f + ":" + String(t)), {});
  (globalThis as any)[g] = g;
}
`;

const made = new Map<string, string>();
// The fixture of a cell. In twin mode there is one for each set of stated options, named by `tag`, and the
// files listed in `project` (the tsconfig.json of the project and what it extends) lose what the user states.
function fixture(name: string, bf: string, files: Record<string, string>, u: States = {}, tag = "", project: string[] = []): string {
  const dir = join(root, twin ? `${name}__${bf}__${tag}` : `${name}__${bf}`);
  if (made.has(dir)) return dir;
  made.set(dir, `<root>/${name}__${bf}`);
  rmSync(dir, { recursive: true, force: true });
  stubs(dir);
  const written: Record<string, string> = {};
  for (const [file, text] of Object.entries(files)) {
    written[file] = project.includes(file) ? left(text, u) : text;
  }
  write(dir, written);
  if (BF[bf] != null) write(dir, { "bunfig.toml": BF[bf]! });
  return dir;
}
function envOf(ne: string): Record<string, string> {
  return ne === "unset" ? {} : { NODE_ENV: ne };
}

type Cell = { key: string; cwd: string; cmd: string[]; env: Record<string, string>; kind: "text" | "marks" };
const cells: Cell[] = [];
const config = (compilerOptions: object, rest: object = {}) => JSON.stringify({ ...rest, compilerOptions });
const classicTh = { jsx: "react", jsxFactory: "th", jsxFragmentFactory: "thf" };

for (const bf of Object.keys(BF)) {
  // N: a nested tsconfig.json
  {
    const files = {
      "tsconfig.json": config({ jsx: "react-jsx", jsxImportSource: "tsrc" }),
      "pkg/tsconfig.json": config(classicTh),
      "pkg/b.tsx": `export const b = () => <span>b</span>;\n`,
      "pkg/run.tsx": globalsSrc + `const { b } = await import("./b");\nconst el = () => <div>a</div>;\nel();\nb();\n`,
      "index.tsx": `import { b } from "./pkg/b";\nexport const el = <div>a</div>;\nexport { b };\n`,
      "run.tsx": globalsSrc + `const { b } = await import("./pkg/b");\nconst el = () => <div>a</div>;\nel();\nb();\n`,
    };
    for (const ne of ENV)
      for (const fl of Object.keys(FL)) {
        const dir = fixture("N", bf, files, userStates(bf, fl), fl, ["tsconfig.json"]);
        const key = (entry: string) => `N|${bf}|${fl}|${ne}|${entry}`;
        const env = envOf(ne);
        cells.push({ key: key("build"), cwd: dir, cmd: [target, "build", "./index.tsx", "--packages=external", ...FL[fl]], env, kind: "text" });
        cells.push({ key: key("run-file"), cwd: dir, cmd: [target, ...FL[fl], "./run.tsx"], env, kind: "marks" });
        // From inside pkg/ the bunfig.toml of the root is not read: only the flags are the user's.
        const inPkg = fixture("N", bf, files, userStates("none", fl), `${fl}-in-pkg`, ["pkg/tsconfig.json"]);
        cells.push({ key: key("run-file-in-pkg"), cwd: join(inPkg, "pkg"), cmd: [target, ...FL[fl], "./run.tsx"], env, kind: "marks" });
      }
  }
  // X: extends
  {
    const files = {
      "base.json": config(classicTh),
      "tsconfig.json": config({ jsxFactory: "th2" }, { extends: "./base.json" }),
      "index.tsx": `export const el = <div>a</div>;\nexport const frag = <><i /></>;\n`,
      "run.tsx": globalsSrc + `const el = () => [<div>a</div>, <><i /></>];\nel();\n`,
    };
    for (const fl of Object.keys(FL)) {
      const dir = fixture("X", bf, files, userStates(bf, fl), fl, ["tsconfig.json", "base.json"]);
      cells.push({ key: `X|${bf}|${fl}|unset|build`, cwd: dir, cmd: [target, "build", "./index.tsx", "--packages=external", ...FL[fl]], env: {}, kind: "text" });
      cells.push({ key: `X|${bf}|${fl}|unset|run-file`, cwd: dir, cmd: [target, ...FL[fl], "./run.tsx"], env: {}, kind: "marks" });
    }
  }
  // E: a tsconfig.json below that extends the one of the project, and one that extends the same base file.
  // What they take from a file of the project gives way. What they state themselves stays.
  {
    const files = {
      "base.json": config(classicTh),
      "tsconfig.json": config({ jsxFactory: "th2" }, { extends: "./base.json" }),
      "pkg/tsconfig.json": config({ jsxFragmentFactory: "thf2" }, { extends: "../tsconfig.json" }),
      "pkg/a.tsx": `export const a = () => [<span>a</span>, <><i /></>];\n`,
      "pkg2/tsconfig.json": config({ jsxFragmentFactory: "thf2" }, { extends: "../base.json" }),
      "pkg2/b.tsx": `export const b = () => [<span>b</span>, <><i /></>];\n`,
      "index.tsx": `import { a } from "./pkg/a";\nimport { b } from "./pkg2/b";\nexport const el = [<div>x</div>, <><i /></>];\nexport { a, b };\n`,
      "run.tsx":
        globalsSrc +
        `const { a } = await import("./pkg/a");\nconst { b } = await import("./pkg2/b");\nconst el = () => [<div>x</div>, <><i /></>];\nel();\na();\nb();\n`,
    };
    for (const ne of ENV)
      for (const fl of Object.keys(FL)) {
        const dir = fixture("E", bf, files, userStates(bf, fl), fl, ["tsconfig.json", "base.json"]);
        const key = (entry: string) => `E|${bf}|${fl}|${ne}|${entry}`;
        const env = envOf(ne);
        cells.push({ key: key("build"), cwd: dir, cmd: [target, "build", "./index.tsx", "--packages=external", ...FL[fl]], env, kind: "text" });
        cells.push({ key: key("run-file"), cwd: dir, cmd: [target, ...FL[fl], "./run.tsx"], env, kind: "marks" });
      }
  }
  // O: --tsconfig-override
  {
    const files = {
      "tsconfig.json": config({ jsx: "react-jsx" }),
      "alt/alt.json": config(classicTh),
      "index.tsx": `export const el = <div>a</div>;\nexport const frag = <><i /></>;\n`,
      "run.tsx": globalsSrc + `const el = () => [<div>a</div>, <><i /></>];\nel();\n`,
    };
    const ov = ["--tsconfig-override", "./alt/alt.json"];
    for (const ne of ENV)
      for (const fl of Object.keys(FL)) {
        // The file of --tsconfig-override keeps what it states.
        const dir = fixture("O", bf, files, userStates(bf, fl), fl, []);
        const key = (entry: string) => `O|${bf}|${fl}|${ne}|${entry}`;
        const env = envOf(ne);
        cells.push({ key: key("build"), cwd: dir, cmd: [target, "build", "./index.tsx", "--packages=external", ...ov, ...FL[fl]], env, kind: "text" });
        cells.push({ key: key("run-file"), cwd: dir, cmd: [target, ...ov, ...FL[fl], "./run.tsx"], env, kind: "marks" });
        cells.push({ key: key("run-run"), cwd: dir, cmd: [target, "run", ...ov, ...FL[fl], "./run.tsx"], env, kind: "marks" });
      }
  }
  // M: a package in node_modules with its own tsconfig.json
  {
    const files = {
      "tsconfig.json": config({ jsx: "react-jsx" }),
      "node_modules/widget/package.json": JSON.stringify({ name: "widget", version: "1.0.0", main: "./index.tsx" }),
      "node_modules/widget/tsconfig.json": config(classicTh),
      "node_modules/widget/index.tsx": `export const w = () => <p>w</p>;\n`,
      "index.tsx": `import { w } from "widget";\nexport const el = <div>a</div>;\nexport { w };\n`,
      "run.tsx": globalsSrc + `const { w } = await import("widget");\nconst el = () => <div>a</div>;\nel();\nw();\n`,
    };
    for (const fl of Object.keys(FL)) {
      const dir = fixture("M", bf, files, userStates(bf, fl), fl, ["tsconfig.json"]);
      cells.push({ key: `M|${bf}|${fl}|unset|build`, cwd: dir, cmd: [target, "build", "./index.tsx", ...EXTERNAL, ...FL[fl]], env: {}, kind: "text" });
      cells.push({ key: `M|${bf}|${fl}|unset|run-file`, cwd: dir, cmd: [target, ...FL[fl], "./run.tsx"], env: {}, kind: "marks" });
    }
  }
  // T: Bun.Transpiler({ tsconfig }). The sources of the process do not reach an instance.
  {
    const dir = fixture("T", bf, {
      "tsconfig.json": config({ jsx: "react-jsx" }),
      "t.ts": `const code = "export const el = <div>a</div>; export const frag = <><i /></>;";
const variants: Record<string, any> = {
  "no-tsconfig": undefined,
  "react-jsx": { compilerOptions: { jsx: "react-jsx" } },
  "classic-th": { compilerOptions: { jsx: "react", jsxFactory: "th", jsxFragmentFactory: "thf" } },
  "src-tsrc": { compilerOptions: { jsx: "react-jsx", jsxImportSource: "tsrc" } },
};
const tsconfig = variants[process.env.T_VARIANT!];
const t = new Bun.Transpiler({ loader: "tsx", autoImportJSX: true, ...(tsconfig && { tsconfig }) });
console.log(t.transformSync(code));
console.log(JSON.stringify(t.scanImports(code)));
`,
    });
    for (const ne of ENV)
      for (const fl of Object.keys(FL))
        for (const v of ["no-tsconfig", "react-jsx", "classic-th", "src-tsrc"])
          cells.push({ key: `T|${bf}|${fl}|${ne}|${v}`, cwd: dir, cmd: [target, ...FL[fl], "./t.ts"], env: { ...envOf(ne), T_VARIANT: v }, kind: "text" });
  }
  // W: a Worker
  {
    const files = {
      "tsconfig.json": config({ jsx: "react-jsx" }),
      "child.tsx": globalsSrc + `const el = () => [<div>a</div>, <><i /></>];\nel();\npostMessage("done");\n`,
      "w.ts": `const w = new Worker(new URL("./child.tsx", import.meta.url).href);\nawait new Promise<void>((resolve, reject) => { w.onmessage = () => resolve(); w.onerror = e => reject(e); });\nw.terminate();\n`,
    };
    for (const fl of Object.keys(FL)) {
      const dir = fixture("W", bf, files, userStates(bf, fl), fl, ["tsconfig.json"]);
      cells.push({ key: `W|${bf}|${fl}|unset|worker`, cwd: dir, cmd: [target, ...FL[fl], "./w.ts"], env: {}, kind: "marks" });
    }
  }
  // V: Bun.build with a file in memory and a module of a plugin
  {
    const files = {
      "tsconfig.json": config({ jsx: "react-jsx", jsxImportSource: "tsrc" }),
      "disk.tsx": `export const d = <div>disk</div>;\n`,
      "build.ts": `const jsxVariants: Record<string, any> = { "none": undefined, "classic-ah": { runtime: "classic", factory: "ah", fragment: "ahf" }, "src-asrc": { importSource: "asrc" } };
const v = process.env.JSX_VARIANT!;
const cfg: any = {
  entrypoints: ["./entry.tsx"],
  packages: "external",
  throw: false,
  files: { "./entry.tsx": 'import { d } from "./disk"; import { p } from "virtual:p"; export const m = <div>mem</div>; export { d, p };' },
  plugins: [{
    name: "virtual",
    setup(b: any) {
      b.onResolve({ filter: /^virtual:p$/ }, () => ({ path: "p", namespace: "virtual" }));
      b.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents: "export const p = <div>plugin</div>;", loader: "tsx" }));
    },
  }],
};
if (v !== "none") cfg.jsx = jsxVariants[v];
const r = await Bun.build(cfg);
if (!r.success) {
  for (const l of r.logs) console.log("BUILD-ERROR: " + String(l.message ?? l));
  process.exit(1);
}
for (const o of r.outputs) console.log(await o.text());
`,
    };
    for (const ne of ENV)
      for (const v of ["none", "classic-ah", "src-asrc"]) {
        // Only the `jsx` option of the build reaches it.
        const dir = fixture("V", bf, files, API_STATES[v] ?? {}, `api-${v}`, ["tsconfig.json"]);
        cells.push({ key: `V|${bf}|-|${ne}|api-${v}`, cwd: dir, cmd: [target, "./build.ts"], env: { ...envOf(ne), JSX_VARIANT: v }, kind: "text" });
      }
  }
}

const baseEnv: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v == null) continue;
  if (k === "NODE_ENV" || k === "BUN_ENV" || k.startsWith("BUN_DEBUG") || k === "JSX_VARIANT" || k === "T_VARIANT") continue;
  baseEnv[k] = v;
}
baseEnv.BUN_DEBUG_QUIET_LOGS = "1";
baseEnv.NO_COLOR = "1";
baseEnv.BUN_RUNTIME_TRANSPILER_CACHE_PATH = "0";

async function runCell(c: Cell) {
  const proc = Bun.spawn({ cmd: c.cmd, cwd: c.cwd, env: { ...baseEnv, ...c.env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const fixtureDir = [...made.keys()].find(dir => c.cwd === dir || c.cwd.startsWith(dir + "/")) ?? c.cwd;
  const scrub = (s: string) => s.replaceAll(fixtureDir, made.get(fixtureDir) ?? fixtureDir).replaceAll(root, "<root>");
  let out: string;
  if (c.kind === "marks") {
    out = (stdout + "\n" + stderr)
      .split("\n")
      .filter(l => l.startsWith("classic") || l.startsWith("auto:"))
      .join(";");
  } else {
    out = scrub(stdout).trim();
  }
  if (code !== 0 || out === "") {
    const firstErr = (stderr + "\n" + stdout)
      .split("\n")
      .map(l => scrub(l).trim())
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
