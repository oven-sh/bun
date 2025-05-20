import * as fs from "fs";
import * as Module from "module";
import { basename, extname } from "path";

const allFiles = fs.readdirSync(".").filter(f => f.endsWith(".js"));
const outdir = process.argv[2];
const builtins = Module.builtinModules;
let commands = [];

let moduleFiles = [];
for (const name of allFiles) {
  const mod = basename(name, extname(name)).replaceAll(".", "/");
  const file = allFiles.find(f => f.startsWith(mod));
  moduleFiles.push(file);
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

  console.log(`bun build ${file} --minify-syntax ${externalModules}`);
  // Create the build command with all the specified options
  const buildCommand =
    Bun.$`bun build --outdir=${outdir} ${name} --minify-syntax  --format=esm --target=node ${{ raw: externalModules }}`.text();

  commands.push(
    buildCommand.then(async text => {
      // This is very brittle. But that should be okay for our usecase
      let outfile = (await Bun.file(`${outdir}/${name}`).text())
        .replaceAll("__require(", "require(")
        .replace(/var __require.*$/gim, "")
        .replaceAll("global.process", "require('process')")
        .trim();

      while (outfile.startsWith("import {")) {
        outfile = outfile.slice(outfile.indexOf(";\n") + 1);
      }

      if (text.includes("import ")) {
        throw new Error("Unexpected import in " + name);
      }

      await Bun.write(`${outdir}/${name}`, outfile);
    }),
  );
}

await Promise.all(commands);
