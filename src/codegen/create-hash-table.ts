import { spawn } from "bun";
import path from "path";
import { writeIfNotChanged } from "./helpers";

const input = process.argv[2];
const output = process.argv[3];

const platform = process.env.TARGET_PLATFORM ?? process.platform;

const create_hash_table = path.join(import.meta.dir, "./create_hash_table");

const input_text = await Bun.file(input).text();
const to_preprocess = [...input_text.matchAll(/@begin\s+.+?@end/gs)].map(m => m[0]).join("\n");

const os = platform === "win32" ? "WINDOWS" : platform.toUpperCase();
const other_oses = ["WINDOWS", "DARWIN", "LINUX"].filter(x => x !== os);
const to_remove = new RegExp(`#if\\s+(!OS\\(${os}\\)|OS\\((${other_oses.join("|")})\\))\\n.*?#endif`, "gs");

const input_preprocessed = to_preprocess.replace(to_remove, "");

console.log("Generating " + output + " from " + input);
const proc = spawn({
  cmd: ["perl", create_hash_table, "-"],
  stdin: "pipe",
  stdout: "pipe",
  stderr: "inherit",
});
proc.stdin.write(input_preprocessed);
proc.stdin.end();
await proc.exited;
if (proc.exitCode !== 0) {
  console.log(
    "Failed to generate " +
      output +
      ", create_hash_table exited with " +
      (proc.exitCode || "") +
      (proc.signalCode || ""),
  );
  process.exit(1);
}
let str = await new Response(proc.stdout).text();
str = str.replaceAll(/^\/\/.*$/gm, "");
str = str.replaceAll(/^#include.*$/gm, "");
str = str.replaceAll(`namespace JSC {`, "");
str = str.replaceAll(`} // namespace JSC`, "");
str = str.replaceAll(/NativeFunctionType,\s([a-zA-Z0-99_]+)/gm, "NativeFunctionType, &$1");
str = "#pragma once" + "\n" + "// File generated via `create-hash-table.ts`\n" + str.trim() + "\n";

writeIfNotChanged(output, str);
