// Runs alone: it judges by the processor seconds of builds.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { reads } from "./harness/reads";
import { testOneByOne as test } from "./supported";

const isSlowBuild = isDebug || isASAN;

async function check(name: string, text: string) {
  using dir = tempDir("aot-many-constants", { [name]: text });
  await using checked = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", `./${name}`],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([checked.stdout.text(), checked.stderr.text(), checked.exited]);
  const seconds = Number(checked.resourceUsage()!.cpuTime.user) / 1e6;
  return { output: stdout + stderr, exitCode, seconds };
}

async function processorSecondsOfCheck(name: string, text: string) {
  const { output, exitCode, seconds } = await check(name, text);
  expect({ output: exitCode ? output : "", exitCode }).toEqual({ output: "", exitCode: 0 });
  return seconds;
}

const rows = (count: number, row: (index: number) => string) =>
  Array.from({ length: count }, (_, index) => row(index)).join("\n");

// Four times the constants take four times as long where the time is linear, and sixteen times as long where it is quadratic.
test("build time is linear in the number of object literals held by constants of one module", async () => {
  const few = isSlowBuild ? 1_000 : 15_000;
  const constants = (count: number) =>
    rows(
      count,
      index => `export const c${index} = { p: ${index} };\nexport function f${index}(): number { return c${index}.p; }`,
    );
  const withFew = await processorSecondsOfCheck("main.ts", constants(few));
  const withMany = await processorSecondsOfCheck("main.ts", constants(4 * few));
  reads("four times the constants", withMany / withFew, 8, "times the processor seconds");
  expect(withMany / withFew).toBeLessThan(8);
}, 240_000);

// For each piece the build read the whole function, the whole loop and every store of the string that the piece goes into.
test("build time is linear in the number of pieces that are appended to one string", async () => {
  const few = isSlowBuild ? 1_000 : 4_000;
  const pieces = (count: number) =>
    `function f(list) {\n  let whole = "";\n  for (const item of list) {\n${rows(
      count,
      index => `let s${index} = ""; s${index} += item; whole += s${index};`,
    )}\n  }\n  return whole;\n}\nconsole.log(f([1]).length);\n`;
  const withFew = await processorSecondsOfCheck("main.js", pieces(few));
  const withMany = await processorSecondsOfCheck("main.js", pieces(4 * few));
  reads("four times the pieces", withMany / withFew, 6, "times the processor seconds");
  expect(withMany / withFew).toBeLessThan(6);
}, 240_000);

// The text of the last member would be 2 ** 59 letters long.
test("the members of an enum that name one another twice do not double for ever", async () => {
  const members = rows(59, index => `m${index + 1} = \`\${m${index}}\${m${index}}\`,`);
  const { output, exitCode } = await check("main.ts", `enum E { m0 = "x", ${members} }\nconsole.log(E.m1);\n`);
  expect(output).toContain("TS18033");
  expect(exitCode).toBe(1);
});
