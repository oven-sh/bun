import { spawn } from "bun";
import path from "path";

const input = process.argv[2];
const out_dir = process.argv[3];

const create_hash_table = path.join(import.meta.dir, "./create_hash_table");

console.time("Generate LUT");
const { stdout, exited } = spawn({
  cmd: [create_hash_table, input],
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
await Bun.write(input.replace(/\.cpp$/, ".lut.h").replace(/(\.lut)?\.txt$/, ".lut.h"), str);
console.log("Wrote", path.join(out_dir, path.basename(process.cwd(), input.replace(/\.cpp$/, ".lut.h"))));
