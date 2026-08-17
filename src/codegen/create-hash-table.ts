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

// `#if ENABLE(FEATURE)` blocks stay only for the features the build enables
// (TARGET_FEATURES, set by scripts/build/codegen.ts from the Config; e.g.
// "webgpu" for ENABLE(WEBGPU)). The perl script ignores the #if/#endif lines
// themselves, so a kept block needs no further processing.
const enabled_features = new Set(
  (process.env.TARGET_FEATURES ?? "")
    .split(",")
    .filter(Boolean)
    .map(f => f.toUpperCase()),
);
const remove_disabled_features = (text: string) =>
  text.replace(/#if\s+ENABLE\((\w+)\)\n.*?#endif/gs, (block, feature: string) =>
    enabled_features.has(feature) ? block : "",
  );

const input_preprocessed = remove_disabled_features(to_preprocess.replace(to_remove, ""));

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
str = str.replaceAll("&Generated::", "Generated::");
str = "#pragma once" + "\n" + "// File generated via `create-hash-table.ts`\n" + str.trim() + "\n";

writeIfNotChanged(output, str);
