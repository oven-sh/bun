// What test/bundler/compile-trim-operations.test.ts asks of a build of Bun that can trim, asked of any build: --explain=trim names the families of run-time operations
// that the image lists. hello world calls one host function by value: the stubs behind that call hold a fast path only for a built-in that the program can get hold of.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const familiesThatHelloWorldMayKeepToday = [
  "proxies",
  "Array.prototype.splice, unshift, sort and join",
  "searches in strings",
  "in, instanceof and hasOwn",
];

test("hello world keeps no family of operations but those that test/bundler/compile-trim-operations.test.ts lists", async () => {
  using dir = tempDir("aot-hello-world-families", { "hello.ts": `console.log("hello world");` });
  const cmd = [bunExe(), "build", "--compile", "--aot", "--explain=trim", "hello.ts", "--outfile", "hello"];
  const { stdout, stderr, exitCode } = await run(cmd, String(dir), bunEnv);
  expect(exitCode).toBe(0);
  const report = (stdout + stderr).split("\n");
  expect(report.some(line => line.includes("trim: uses console log"))).toBe(true);
  const kept = report.flatMap(line => line.match(/kept what compiled code calls for (.*): used$/)?.[1] ?? []);
  expect(kept.filter(each => !familiesThatHelloWorldMayKeepToday.includes(each))).toEqual([]);
}, 120_000);
