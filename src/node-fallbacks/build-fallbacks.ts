import * as fs from "fs";
import * as Module from "module";
import { basename, extname } from "path";
import * as zlib from "zlib";

const allFiles = fs.readdirSync(".").filter(f => f.endsWith(".js"));
const outdir = process.argv[2];
const builtins = Module.builtinModules;
let commands: Promise<void>[] = [];

let moduleFiles: string[] = [];
for (const name of allFiles) {
  const mod = basename(name, extname(name)).replaceAll(".", "/");
  const file = allFiles.find(f => f.startsWith(mod));
  moduleFiles.push(file as string);
}

for (let fileIndex = 0; fileIndex < allFiles.length; fileIndex++) {
  const name = allFiles[fileIndex];

  // Build all files at once with specific options
  const externalModules = builtins
    .concat(moduleFiles.filter(f => f !== name))
    .flatMap(b => [`--external:node:${b}`, `--external:${b}`])
    .join(" ");

  // A source that sets `module.exports` stays CommonJS, so `require()` of the polyfill returns that value.
  const format = /^module\.exports\s*=/m.test(fs.readFileSync(name, "utf8")) ? "cjs" : "esm";

  // Free `process` / `Buffer` in the npm packages: rename, then import from the sibling polyfill.
  const injectedGlobals = [
    {
      defines: ["process", "global.process"],
      id: "__bun_process",
      skip: ["process.js"],
      esm: 'import __bun_process from "process";',
      cjs: 'var __bun_process = require("process").default;',
    },
    {
      defines: ["Buffer", "global.Buffer"],
      id: "__bun_Buffer",
      // assert.js: only npm util's never-called isBuffer() names Buffer; the import would cost 31 KB.
      skip: ["buffer.js", "assert.js"],
      esm: 'import { Buffer as __bun_Buffer } from "buffer";',
      cjs: 'var __bun_Buffer = require("buffer").Buffer;',
    },
  ].filter(g => !g.skip.includes(name));
  const defineGlobals = injectedGlobals.flatMap(g => g.defines.map(d => `--define=${d}:${g.id}`)).join(" ");

  // Create the build command with all the specified options
  const buildCommand =
    Bun.$`bun build --define=process.env.NODE_DEBUG:"false" --define=process.env.READABLE_STREAM="'enable'" --define=global:globalThis ${{ raw: defineGlobals }} --outdir=${outdir} ${name} --minify-syntax --minify-whitespace --format=${format} --target=node ${{ raw: externalModules }}`.text();

  commands.push(
    buildCommand.then(async () => {
      // This is very brittle. But that should be okay for our usecase
      let outfile = fs
        .readFileSync(`${outdir}/${name}`, "utf8")
        .replaceAll("__require(", "require(")
        .replaceAll("import.meta.url", "''")
        .replaceAll("createRequire", "")
        .trim();

      while (outfile.startsWith("import{")) {
        outfile = outfile.slice(outfile.indexOf(";") + 1);
      }

      for (const { id, esm, cjs } of injectedGlobals) {
        if (!outfile.includes(id)) continue;
        outfile = (format === "cjs" ? cjs : esm) + outfile;
      }

      if (outfile.includes('"node:module"')) {
        console.log(outfile);
        throw new Error("Unexpected import in " + name);
      }

      if (outfile.includes("import.meta")) {
        throw new Error("Unexpected import.meta in " + name);
      }

      if (outfile.includes(".$apply")) {
        throw new Error("$apply is not supported in browsers (while building " + name + ")");
      }

      if (outfile.includes(".$call")) {
        throw new Error("$call is not supported in browsers (while building " + name + ")");
      }

      if (
        outfile.includes("$isObject(") ||
        outfile.includes("$isPromise(") ||
        outfile.includes("$isUndefinedOrNull(") ||
        outfile.includes("$newPromiseCapability(")
      ) {
        throw new Error("Unsupported function in " + name);
      }

      fs.writeFileSync(`${outdir}/${name}`, outfile);
      // Release builds embed the zstd-compressed copy (see
      // src/resolver/node_fallbacks.rs) so the ~1 MB of polyfill text doesn't
      // sit uncompressed in the binary; debug builds keep reading the plain
      // `.js` at runtime.
      fs.writeFileSync(
        `${outdir}/${name}.zst`,
        zlib.zstdCompressSync(Buffer.from(outfile), { params: { [zlib.constants.ZSTD_c_compressionLevel]: 19 } }),
      );
    }),
  );
}

await Promise.all(commands);
