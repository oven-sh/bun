// TODO: move this file somewhere else. it doesnt make sense in src/js/
// it generates C++ code not related to javascript at all
import { spawn } from "bun";
import path from "../node/path";

const STATIC_HASH_TABLES = [
  //
  "src/bun.js/bindings/BunObject.cpp",
  "src/bun.js/bindings/ZigGlobalObject.lut.txt",
  "src/bun.js/bindings/JSBuffer.cpp",
  "src/bun.js/bindings/Process.cpp",
  "src/bun.js/bindings/ProcessBindingConstants.cpp",
  "src/bun.js/bindings/ProcessBindingNatives.cpp",
];

console.time("Creating static hash tables...");
const create_hash_table = path.join(import.meta.dir, "../../../src/bun.js/scripts/create_hash_table");
if (!create_hash_table) {
  console.warn("Could not find create_hash_table executable. Run `bun i` or clone webkit to build static hash tables");
  process.exit(1);
}

await Promise.all(
  STATIC_HASH_TABLES.map(async cpp => {
    cpp = path.join(import.meta.dir, "../../../", cpp);
    const { stdout, exited } = spawn({
      cmd: [create_hash_table, cpp],
      stdout: "pipe",
      stderr: "inherit",
    });
    await exited;
    let str = await new Response(stdout).text();
    str = str.replaceAll(/^\/\/.*$/gm, "");
    str = str.replaceAll(/^#include.*$/gm, "");
    str = str.replaceAll(`namespace JSC {`, "");
    str = str.replaceAll(`} // namespace JSC`, "");
    str = "// File generated via `make static-hash-table` / `make cpp`\n" + str.trim() + "\n";
    await Bun.write(cpp.replace(/\.cpp$/, ".lut.h").replace(/(\.lut)?\.txt$/, ".lut.h"), str);
    console.log("Wrote", path.relative(process.cwd(), cpp.replace(/\.cpp$/, ".lut.h")));
  }),
);

console.timeEnd("Creating static hash tables...");
