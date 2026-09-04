import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import { writeIfNotChanged } from "./helpers.ts";

const platform = process.env.TARGET_PLATFORM ?? process.platform;

const create_hash_table = path.join(import.meta.dirname, "./create_hash_table");

/** Writes to `output` the JSC hash tables for the `@begin ... @end` blocks in `input`. */
export function createHashTable(input: string, output: string): void {
  const input_text = readFileSync(input, "utf8");
  const to_preprocess = [...input_text.matchAll(/@begin\s+.+?@end/gs)].map(m => m[0]).join("\n");

  const os = platform === "win32" ? "WINDOWS" : platform.toUpperCase();
  const other_oses = ["WINDOWS", "DARWIN", "LINUX"].filter(x => x !== os);
  const to_remove = new RegExp(`#if\\s+(!OS\\(${os}\\)|OS\\((${other_oses.join("|")})\\))\\n.*?#endif`, "gs");

  const input_preprocessed = to_preprocess.replace(to_remove, "");

  console.log("Generating " + output + " from " + input);
  const proc = spawnSync("perl", [create_hash_table, "-"], {
    input: input_preprocessed,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
  });
  if (proc.error) throw proc.error;
  if (proc.status !== 0) {
    console.log(
      "Failed to generate " + output + ", create_hash_table exited with " + (proc.status || "") + (proc.signal || ""),
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
}

if (import.meta.main) {
  createHashTable(process.argv[2], process.argv[3]);
}
