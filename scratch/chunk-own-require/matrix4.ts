// usage: bun matrix.ts <builder bun binary> <label>
// Builds forms x placements x layouts x targets, split and un-split, runs each entry, and writes
// /tmp/measure/matrix-<label>.json: { "<layout>|<target>|<split>|<placement>|<form>": value }
// The runtime files mirror the source tree: src/lib.js is out/lib.js, node_modules is out/node_modules.
import { mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";

const [builder, label] = process.argv.slice(2);
const root = `/tmp/measure/matrix4-${label}`;
rmSync(root, { recursive: true, force: true });

const forms = (up: string, addon: string) => `{
  literal: attempt(() => require("${up}lib.js")),
  computed: attempt(() => require(beside("lib.js"))),
  resolve: attempt(() => fromRoot(require.resolve("${up}lib.js"))),
  resolveComputed: attempt(() => fromRoot(require.resolve(beside("lib.js")))),
  passed: attempt(() => (load => load(beside("lib.js")))(require)),
  paths: attempt(() => fromRoot(require.resolve.paths("pkg")[0])),
  bare: attempt(() => require("pkg")),
  addon: attempt(() => require("./${addon}.node")),
}`;

// A file at `file` (under /src) that exports its forms. `up` leads from its directory to /src.
function formsFile(file: string, name: string) {
  const dir = dirname(file);
  let up = relative(dir, "/src").replaceAll("\\", "/");
  up = up === "" ? "./" : up + "/";
  const helpers = relative(dir, "/src/helpers.js").replaceAll("\\", "/");
  return {
    [file]: `
      import { attempt, fromRoot } from "${helpers.startsWith(".") ? helpers : "./" + helpers}";
      const beside = file => "${up}" + file;
      export const ${name} = () => (${forms(up, name)});
    `,
    [join(dir, name + ".node")]: "not an addon: " + name,
  };
}

const helpers = `
  import path from "node:path";
  export function attempt(fn) { try { return fn(); } catch (e) { return e.code ?? String(e); } }
  export const fromRoot = file => path.relative(process.cwd(), file).replaceAll("\\\\", "/");
`;

const layouts = {
  dirs: { entry: (n: string) => `/src/${n}/entry.js`, out: (n: string) => `${n}/entry.js`, flags: [] as string[] },
  chunksdir: {
    entry: (n: string) => `/src/${n}.js`,
    out: (n: string) => `${n}.js`,
    flags: ["--chunk-naming", "chunks/[name]-[hash].[ext]"],
  },
  hashdir: {
    entry: (n: string) => `/src/${n}.js`,
    out: (n: string) => `${n}.js`,
    flags: ["--chunk-naming", "[hash]/[name].[ext]"],
  },
  hashdir2: {
    entry: (n: string) => `/src/${n}.js`,
    out: (n: string) => `${n}.js`,
    flags: ["--chunk-naming", "a/c-[hash]/[name].[ext]"],
  },
};

const result: Record<string, unknown> = {};
for (const [layoutName, layout] of Object.entries(layouts)) {
  for (const target of ["bun", "node"]) {
    for (const split of ["split", "unsplit"]) {
      const dir = join(root, `${layoutName}-${target}-${split}`);
      const files: Record<string, string> = { "/src/helpers.js": helpers };
      for (const n of ["a", "b"]) {
        const entry = layout.entry(n);
        const entryDir = dirname(entry);
        const rel = (to: string) => {
          const r = relative(entryDir, to).replaceAll("\\", "/");
          return r.startsWith(".") ? r : "./" + r;
        };
        Object.assign(
          files,
          formsFile(join(entryDir, `${n}Side.js`), `${n}S`),
          formsFile(`/src/util/${n}Only.js`, `${n}U`),
          formsFile(`/src/common/shared.js`, `H`),
        );
        // The entry holds its own forms (E) and prints those of the other placements.
        const own = formsFile(join(entryDir, `__${n}.js`), `${n}E`);
        const ownBody = Object.values(own)[0]
          .replace(/export const \w+ = \(\) => /, "const E = () => ")
          .trim();
        files[join(entryDir, `${n}E.node`)] = "not an addon: entry " + n;
        files[entry] = `
          ${ownBody}
          import { ${n}S } from "${rel(join(entryDir, `${n}Side.js`))}";
          import { ${n}U } from "${rel(`/src/util/${n}Only.js`)}";
          import { H } from "${rel(`/src/common/shared.js`)}";
          console.log(JSON.stringify({ E: E(), S: ${n}S(), U: ${n}U(), H: H() }));
        `;
      }
      for (const [file, text] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, file)), { recursive: true });
        writeFileSync(join(dir, file), text);
      }
      const build = Bun.spawnSync({
        cmd: [
          builder,
          "build",
          "." + layout.entry("a"),
          "." + layout.entry("b"),
          "--outdir",
          "out",
          "--target",
          target,
          "--format",
          "esm",
          "--external",
          "*/lib.js",
          "--external",
          "pkg",
          ...(split === "split" ? ["--splitting", "--no-split-require"] : []),
          ...(split === "split" ? layout.flags : []),
        ],
        cwd: dir,
        env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
        stderr: "pipe",
        stdout: "pipe",
      });
      if (build.exitCode !== 0) {
        result[`${layoutName}|${target}|${split}`] = "BUILD FAILED: " + build.stderr.toString().slice(0, 300);
        continue;
      }
      // Mirror of the source tree.
      writeFileSync(join(dir, "out/lib.js"), `module.exports = "out/lib.js";`);
      mkdirSync(join(dir, "out/node_modules/pkg"), { recursive: true });
      writeFileSync(join(dir, "out/node_modules/pkg/index.js"), `module.exports = "out/node_modules/pkg";`);
      for (const n of ["a", "b"]) {
        const run = Bun.spawnSync({
          cmd: [target === "bun" ? process.execPath : "node", join("out", layout.out(n))],
          cwd: dir,
          env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
          stderr: "pipe",
          stdout: "pipe",
        });
        let parsed: any;
        try {
          parsed = JSON.parse(run.stdout.toString());
        } catch {
          parsed = { E: {}, S: {}, U: {}, H: {} };
          result[`${layoutName}|${target}|${split}|${n}|RUN`] = run.stderr.toString().slice(0, 300);
        }
        for (const [placement, cells] of Object.entries<any>(parsed)) {
          for (const [form, value] of Object.entries(cells)) {
            result[`${layoutName}|${target}|${split}|${n}:${placement}|${form}`] = value;
          }
        }
      }
    }
  }
}
writeFileSync(`/tmp/measure/matrix4-${label}.json`, JSON.stringify(result, null, 1));
console.log(Object.keys(result).length, "cells");
