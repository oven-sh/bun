import { expect, test } from "bun:test";
import { join } from "node:path";
import { bunExe, tempDir } from "../../../../../../test/harness";
import { FormatterCancelledError, getBunFormatterArgs, runBunFormatter } from "../process";

test("passes selection offsets to Bun", () => {
  expect(getBunFormatterArgs("/project/index.ts", undefined, { start: 10, end: 20 })).toEqual([
    "fmt",
    "--no-script",
    "--stdin-filepath",
    "/project/index.ts",
    "--range-start=10",
    "--range-end=20",
  ]);
});

test("passes an explicit bunfig to Bun", () => {
  expect(getBunFormatterArgs("/project/index.ts", "/home/user/.bunfig.toml")).toEqual([
    "--config=/home/user/.bunfig.toml",
    "fmt",
    "--no-script",
    "--stdin-filepath",
    "/project/index.ts",
  ]);
});

test("formats stdin with Bun's built-in formatter", async () => {
  using dir = tempDir("bun-vscode-formatter", {
    "bunfig.toml": "[fmt]\nsingleQuote = true\n",
    "package.json": JSON.stringify({
      scripts: {
        fmt: "echo PACKAGE_SCRIPT_SHOULD_NOT_RUN",
      },
    }),
  });

  const result = await runBunFormatter({
    runtime: bunExe(),
    cwd: String(dir),
    filepath: join(String(dir), "index.ts"),
    source: 'const answer={value:"yes"}\n',
  });

  expect(result.stdout).toBe("const answer = { value: 'yes' };\n");
  expect(result.stderr).toBe("");
});

test("does not start formatting after cancellation", async () => {
  const token = {
    isCancellationRequested: true,
    onCancellationRequested: () => ({ dispose() {} }),
  };

  await expect(
    runBunFormatter({
      runtime: bunExe(),
      cwd: process.cwd(),
      filepath: join(process.cwd(), "index.ts"),
      source: "const answer=42",
      token,
    }),
  ).rejects.toBeInstanceOf(FormatterCancelledError);
});
