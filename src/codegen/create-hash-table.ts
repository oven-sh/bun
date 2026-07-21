import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { writeIfNotChanged } from "./helpers";

const input = process.argv[2];
const output = process.argv[3];

const platform = process.env.TARGET_PLATFORM ?? process.platform;

const create_hash_table = path.join(import.meta.dirname, "./create_hash_table");

const input_text = readFileSync(input, "utf8");
const to_preprocess = [...input_text.matchAll(/@begin\s+.+?@end/gs)].map(m => m[0]).join("\n");

const os = platform === "win32" ? "WINDOWS" : platform.toUpperCase();
const other_oses = ["WINDOWS", "DARWIN", "LINUX"].filter(x => x !== os);
const to_remove = new RegExp(`#if\\s+(!OS\\(${os}\\)|OS\\((${other_oses.join("|")})\\))\\n.*?#endif`, "gs");

const input_preprocessed = to_preprocess.replace(to_remove, "");

console.log("Generating " + output + " from " + input);
const proc = spawnSync("perl", [create_hash_table, "-"], {
  input: input_preprocessed,
  stdio: ["pipe", "pipe", "inherit"],
  encoding: "utf8",
});
if (proc.status !== 0) {
  console.log(
    "Failed to generate " + output + ", create_hash_table exited with " + (proc.status ?? "") + (proc.signal ?? ""),
  );
  process.exit(1);
}
let str = proc.stdout;
str = str.replaceAll(/^\/\/.*$/gm, "");
str = str.replaceAll(/^#include.*$/gm, "");
str = str.replaceAll(`namespace JSC {`, "");
str = str.replaceAll(`} // namespace JSC`, "");
str = str.replaceAll(/NativeFunctionType,\s([a-zA-Z0-99_]+)/gm, "NativeFunctionType, &$1");
str = str.replaceAll("&Generated::", "Generated::");
str = "#pragma once" + "\n" + "// File generated via `create-hash-table.ts`\n" + str.trim() + "\n";

writeIfNotChanged(output, str);
