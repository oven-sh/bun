import * as fs from "fs";
import * as Module from "module";
import { basename, extname } from "path";
import * as zlib from "zlib";

const allFiles = fs.readdirSync(".").filter(f => f.endsWith(".js"));
const outdir = process.argv[2];
const builtins = Module.builtinModules;
let commands: Promise<void>[] = [];

const commonJSFiles = ["assert.js", "events.js", "stream.js"];

let moduleFiles: string[] = [];
for (const name of allFiles) {
  const mod = basename(name, extname(name)).replaceAll(".", "/");
  const file = allFiles.find(f => f.startsWith(mod));
  moduleFiles.push(file as string);
}

for (let fileIndex = 0; fileIndex < allFiles.length; fileIndex++) {
  const name = allFiles[fileIndex];
  const mod = basename(name, extname(name)).replaceAll(".", "/");
  const file = allFiles.find(f => f.startsWith(mod));
  const externals = [...builtins];
  const i = externals.indexOf(name);
  if (i !== -1) {
    externals.splice(i, 1);
  }

  // Build all files at once with specific options
  const externalModules = builtins
    .concat(moduleFiles.filter(f => f !== name))
    .flatMap(b => [`--external:node:${b}`, `--external:${b}`])
    .join(" ");

  // Create the build command with all the specified options
  const buildCommand =
    Bun.$`bun build --define=process.env.NODE_DEBUG:"false" --define=process.env.READABLE_STREAM="'enable'" --define=global:globalThis --outdir=${outdir} ${name} --minify-syntax --minify-whitespace --format=${commonJSFiles.includes(name) ? "cjs" : "esm"} --target=node ${{ raw: externalModules }}`.text();

  commands.push(
    buildCommand.then(async text => {
      // This is very brittle. But that should be okay for our usecase
      let outfile = fs
        .readFileSync(`${outdir}/${name}`, "utf8")
        .replaceAll("__require(", "require(")
        .replaceAll("import.meta.url", "''")
        .replaceAll("createRequire", "")
        .replaceAll("global.process", "require('process')")
        .trim();

      while (outfile.startsWith("import{")) {
        outfile = outfile.slice(outfile.indexOf(";") + 1);
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
