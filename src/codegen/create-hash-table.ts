import { spawn } from "bun";
import path from "path";
import { writeIfNotChanged } from "./helpers";

const input = process.argv[2];
const output = process.argv[3];

const create_hash_table = path.join(import.meta.dir, "./create_hash_table");

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
str = "// File generated via `static-hash-table.ts`\n" + str.trim() + "\n";

writeIfNotChanged(output, str);
