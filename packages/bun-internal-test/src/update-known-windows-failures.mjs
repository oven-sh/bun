import assert from "assert";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

if (process.platform !== "win32") {
  console.log("This script is only intended to be run on Windows.");
  process.exit(1);
}

process.chdir(join(fileURLToPath(import.meta.url), "../../../../"));

if (!existsSync("test-report.json")) {
  console.log("No test report found. Please run `bun run test` first.");
  process.exit(1);
}

const test_report = JSON.parse(readFileSync("test-report.json", "utf8"));
assert(Array.isArray(test_report.failing_tests));

for (const { path, reason, expected_crash_reason } of test_report.failing_tests) {
  assert(path);
  assert(reason);

  if (expected_crash_reason !== reason) {
    const old_content = readFileSync(path, "utf8");
    if (!old_content.includes("// @known-failing-on-windows")) {
      let content = old_content.replace(/\/\/\s*@known-failing-on-windows:.*\n/, "");
      if (reason) {
        content = `// @known-failing-on-windows: ${reason}\n` + content;
      }
      writeFileSync(path, content, "utf8");
      console.log(path);
    }
  }
}

for (const { path } of test_report.fixes) {
  assert(path);

  const old_content = readFileSync(path, "utf8");

  let content = old_content.replace(/\/\/\s*@known-failing-on-windows:.*\n/, "");

  if (content !== old_content) {
    writeFileSync(path, content, "utf8");
    console.log(path);
  }
}
