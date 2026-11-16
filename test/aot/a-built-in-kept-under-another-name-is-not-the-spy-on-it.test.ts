// `text.replace(pattern, function)` goes to an operation of the run time, which calls the engine's own String.prototype.replace, so that a stack trace lists its frame. It fetched that function by its name,
// off String.prototype, when it ran. In a test run a spy may lie there: the original function, kept under another name, then called the spy that stood in for it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  // A crash prints only there, and the comparison below would hide it.
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout, results, exitCode };
}

async function expectCompiledToRunAsPlain(files: Record<string, string>) {
  using dir = tempDir("built-in-under-another-name", files);
  const plain = await runTests(String(dir));
  expect(plain.results.filter(result => result.startsWith("fail"))).toEqual([]);
  expect(plain.results).not.toEqual([]);
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}

// What lies under the name while the original is called under another. Each site runs 300 times: a site that runs once takes the general way.
const standIns: [string, string, string][] = [
  [
    "a spy that answers a text",
    `const spy = spyOn(String.prototype, "replace").mockImplementation(() => "mocked");`,
    `seen = spy.mock.calls.length; spy.mockRestore();`,
  ],
  [
    "a spy that answers undefined",
    `const spy = spyOn(String.prototype, "replace").mockImplementation(() => undefined as any);`,
    `seen = spy.mock.calls.length; spy.mockRestore();`,
  ],
  [
    "a spy that answers a number",
    `const spy = spyOn(String.prototype, "replace").mockImplementation(() => 7 as any);`,
    `seen = spy.mock.calls.length; spy.mockRestore();`,
  ],
  [
    "a spy that throws",
    `const spy = spyOn(String.prototype, "replace").mockImplementation(() => { throw new Error("the spy ran"); });`,
    `seen = spy.mock.calls.length; spy.mockRestore();`,
  ],
  [
    "a spy that calls through",
    `const spy = spyOn(String.prototype, "replace");`,
    `seen = spy.mock.calls.length; spy.mockRestore();`,
  ],
  [
    "a bound function",
    `(String.prototype as any).replace = function () { seen++; return "bound"; }.bind(null);`,
    `String.prototype.replace = original;`,
  ],
  [
    "a function of the test",
    `(String.prototype as any).replace = function () { seen++; return "written"; };`,
    `String.prototype.replace = original;`,
  ],
  [
    "another built-in",
    `(String.prototype as any).replace = String.prototype.concat;`,
    `String.prototype.replace = original;`,
  ],
  ["what is no function", `(String.prototype as any).replace = 5;`, `String.prototype.replace = original;`],
  ["nothing", `delete (String.prototype as any).replace;`, `String.prototype.replace = original;`],
];

const roads: [string, string][] = [
  ["under another name on the prototype", `"abc".swap(/b/, () => "X")`],
  ["under another name, every match", `"abcb".swap(/b/g, (match: string, at: number) => match + at)`],
  ["under another name, no match", `"abc".swap(/z/, () => "X")`],
  ["under another name, a text in place of the function", `"abc".swap(/b/, "[$&]")`],
  [
    "under another name, of a value nobody has typed",
    `(anything("abc") as any).swap(anything(/b/), anything(() => "X"))`,
  ],
  ["out of a variable, by call", `original.call("abc", /b/, () => "X")`],
  ["out of a variable, by apply", `original.apply("abc", [/b/, () => "X"])`],
  ["out of a variable, by Reflect.apply", `Reflect.apply(original, "abc", [/b/, () => "X"])`],
  ["bound to its text", `bound(/b/, () => "X")`],
  ["under the name itself", `attempt(() => ("abc" as any).replace(/b/, () => "X"))`],
];

test("the original function is itself, whatever lies under its name", async () => {
  await expectCompiledToRunAsPlain({
    "one.test.ts": `
      import { spyOn, test } from "bun:test";
      declare global { interface String { swap: String["replace"] } }
      const original = String.prototype.replace;
      const bound = original.bind("abc") as (pattern: RegExp, replacement: () => string) => string;
      const anything = (value: unknown) => [value, 1, "two"][Number(process.argv.length > 99)];
      const attempt = (run: () => unknown) => { try { return run(); } catch (error) { return (error as Error).name + ": " + (error as Error).message; } };
      ${standIns
        .map(
          ([what, lay, takeAway]) => `
      test(${JSON.stringify(what)}, () => {
        const lines: string[] = [];
        ${roads
          .map(
            ([road, call]) => `{
          let seen = 0;
          let out: unknown;
          String.prototype.swap = original;
          ${lay}
          try {
            for (let turn = 0; turn < 300; turn++) out = ${call};
          } catch (error) {
            out = "thrown: " + (error as Error).message;
          } finally {
            ${takeAway}
            delete (String.prototype as any).swap;
          }
          lines.push(${JSON.stringify(road)} + ": " + typeof out + " " + String(out) + " " + seen);
        }`,
          )
          .join("\n        ")}
        console.log(lines.join("\\n"));
      });`,
        )
        .join("\n")}`,
  });
});

test("a stack trace out of the function that replaces lists the engine's frame, with a spy under the name too", async () => {
  await expectCompiledToRunAsPlain({
    "one.test.ts": `
      import { spyOn, test } from "bun:test";
      declare global { interface String { swap: String["replace"] } }
      test("the frames", () => {
        String.prototype.swap = String.prototype.replace;
        const spy = spyOn(String.prototype, "replace").mockImplementation(() => "mocked");
        let names = "";
        for (let turn = 0; turn < 300; turn++)
          "abc".swap(/b/, function replacer() {
            names = new Error().stack!.split("\\n").slice(1, 3).map(line => line.trim().split(" ")[1]).join();
            return "X";
          });
        spy.mockRestore();
        delete (String.prototype as any).swap;
        console.log(names);
      });`,
  });
});
