// composite-gen-fixtures.mjs — generates the local, network-free fixtures used by the
// composite-* benchmarks in this directory. Idempotent: skips work if fixtures exist
// (pass --force to regenerate). Runnable by both `node` and `bun`; the install fixture
// additionally shells out to `bun pm pack` (override binary with BENCH_BUN).
//
// Fixtures produced (under ./fixtures/):
//   modules-100|300|600/  CommonJS require-tree app (binary tree, extensionless requires)
//                         for the startup/resolution + bundler composites.
//   install/              12 local packages, packed to .tgz; consumer/package.json depends
//                         on them via file: tarball paths. No registry, no network.
//                         consumer/bunfig.toml pins linker=hoisted so the repo-root
//                         bunfig.toml ([install] linker=isolated) cannot leak in.
//   tests/                50 trivial bun:test files + local bunfig.toml/package.json so the
//                         repo-root [test] preload guard does not apply.
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures");
const BUN = process.env.BENCH_BUN || "bun";
const force = process.argv.includes("--force");

function genModules(n, exact = false) {
  const name = `modules-${n}${exact ? "-exact" : ""}`;
  const dir = join(FIX, name);
  if (existsSync(join(dir, "index.js")) && !force) return console.log(`skip ${name} (exists)`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `fixture-${name}`, version: "1.0.0", private: true }));
  // Binary require tree rooted at m0. Default: extensionless specifiers ("./mK") so the
  // resolver must probe mK then mK.js. The -exact variant ("./mK.js") skips probing —
  // comparing the two isolates the resolver-probe cost from load+parse+eval.
  const ext = exact ? ".js" : "";
  for (let i = 0; i < n; i++) {
    const kids = [2 * i + 1, 2 * i + 2].filter(k => k < n);
    const reqs = kids.map((k, j) => `const c${j} = require('./m${k}${ext}');`).join("\n");
    const sum = ["1", ...kids.map((_, j) => `(c${j} | 0)`)].join(" + ");
    writeFileSync(join(dir, `m${i}.js`), `'use strict';\n${reqs}\nconst tag = 'module-${i}';\nmodule.exports = ${sum} + tag.length % 2;\n`);
  }
  writeFileSync(
    join(dir, "index.js"),
    `'use strict';\nconst t0 = process.hrtime.bigint();\nconst v = require('./m0${ext}');\nconst t1 = process.hrtime.bigint();\nconsole.log(JSON.stringify({ requireMs: Number(t1 - t0) / 1e6, modules: ${n}, v }));\n`,
  );
  console.log(`generated ${name}`);
}

function genInstall() {
  const root = join(FIX, "install");
  const NPKG = 12, NFILES = 40;
  if (existsSync(join(root, "consumer", "package.json")) && !force) return console.log("skip install (exists)");
  rmSync(root, { recursive: true, force: true });
  const tarballs = join(root, "tarballs");
  mkdirSync(tarballs, { recursive: true });
  const deps = {};
  for (let p = 0; p < NPKG; p++) {
    const name = `bench-pkg-${String(p).padStart(2, "0")}`;
    const src = join(root, "src", name);
    mkdirSync(join(src, "lib"), { recursive: true });
    writeFileSync(join(src, "package.json"), JSON.stringify({ name, version: "1.0.0", main: "index.js", files: ["index.js", "lib", "README.md"] }, null, 2));
    writeFileSync(join(src, "README.md"), `# ${name}\nlocal benchmark fixture package.\n`);
    writeFileSync(join(src, "index.js"), `'use strict';\nmodule.exports = require('./lib/f00.js');\n`);
    for (let f = 0; f < NFILES; f++) {
      const next = f + 1 < NFILES ? `require('./f${String(f + 1).padStart(2, "0")}.js') + ` : "";
      writeFileSync(join(src, "lib", `f${String(f).padStart(2, "0")}.js`), `'use strict';\n// ${name} file ${f}\nconst data = '${"x".repeat(160)}';\nmodule.exports = ${next}data.length;\n`);
    }
    const r = spawnSync(BUN, ["pm", "pack", "--destination", tarballs, "--quiet"], { cwd: src, encoding: "utf8", windowsHide: true });
    if (r.status !== 0) { console.error(`bun pm pack failed for ${name}:\n${r.stdout}${r.stderr}`); process.exit(1); }
    deps[name] = `file:../tarballs/${name}-1.0.0.tgz`;
  }
  const consumer = join(root, "consumer");
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "bench-consumer", version: "1.0.0", private: true, dependencies: deps }, null, 2));
  // Pin the linker so the repo root bunfig.toml (linker=isolated) can't change the layout.
  writeFileSync(join(consumer, "bunfig.toml"), `[install]\nlinker = "hoisted"\nglobalStore = false\n`);
  console.log(`generated install (${NPKG} pkgs x ~${NFILES + 3} files, tarballs packed)`);
}

function genTests() {
  const dir = join(FIX, "tests");
  const NTESTS = 50;
  if (existsSync(join(dir, "t00.test.ts")) && !force) return console.log("skip tests (exists)");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture-tests", version: "1.0.0", private: true }));
  // Local bunfig shields the repo-root [test] preload (which forbids release `bun test`).
  writeFileSync(join(dir, "bunfig.toml"), `[test]\nroot = "."\n`);
  for (let i = 0; i < NTESTS; i++) {
    const id = String(i).padStart(2, "0");
    writeFileSync(join(dir, `t${id}.test.ts`), `import { test, expect } from "bun:test";\ntest("t${id} arithmetic", () => { expect(1 + ${i}).toBe(${i + 1}); });\ntest("t${id} strings", () => { expect("ab".repeat(2)).toBe("abab"); });\n`);
  }
  console.log(`generated tests (${NTESTS} files)`);
}

mkdirSync(FIX, { recursive: true });
writeFileSync(join(HERE, ".gitignore"), "fixtures/\nout-build/\n");
genModules(100);
genModules(300);
genModules(600);
genModules(600, true);
genInstall();
genTests();
console.log("fixtures ready:", FIX);
