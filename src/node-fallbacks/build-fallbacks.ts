import * as Module from "module";
import * as fs from "fs";
import { basename, extname } from "path";

const allFiles = fs.readdirSync(".").filter(f => f.endsWith(".js"));

const builtins = Module.builtinModules;
fs.rmSync("out", { recursive: true, force: true });
for (const name of allFiles) {
  const mod = basename(name, extname(name)).replaceAll(".", "/");
  const file = allFiles.find(f => f.startsWith(mod));
  const externals = [...builtins];
  const i = externals.indexOf(name);
  if (i !== -1) {
    externals.splice(i, 1);
  }

  // Build all files at once with specific options
  const externalModules = builtins.flatMap(b => [`--external:node:${b}`, `--external:${b}`]).join(" ");
  console.log(`bun build ${file} --minify-syntax ${externalModules}`);
  // Create the build command with all the specified options
  const buildCommand = await Bun.$`bun build --outdir=out ${name} --minify --target=browser ${externalModules}`.text();
  console.log(buildCommand);
}
