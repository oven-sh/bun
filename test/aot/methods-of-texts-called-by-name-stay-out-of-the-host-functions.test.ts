import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const turns = 3000;
const files = {
  "main.mjs": String.raw`
    const steps = [
      ["includes", "="], ["endsWith", "e"], ["split", ";"], ["split", /\s*=\s*/], ["charAt", 1], ["charCodeAt", 1], ["codePointAt", 1], ["toUpperCase"], ["trimStart"], ["trimEnd"],
      ["match", /\w+/], ["replace", "=", ": "], ["replace", /\d/, "#"], ["replace", /[a-z]/, found => found + found], ["replace", /never/, found => found + found],
    ];
    const questions = [["test", "a1"], ["exec", "a1"], ["test", "none"]];
    const texts = ["  a=1;b=2  ", "name = value", "none"];
    function call(receiver, [name, ...rest]) {
      return rest.length === 0 ? receiver[name]() : rest.length === 1 ? receiver[name](rest[0]) : receiver[name](rest[0], rest[1]);
    }
    let sum = 0;
    for (let i = 0; i < ${turns}; i++) {
      for (const step of steps) sum += String(call(texts[i % texts.length], step)).length;
      for (const question of questions) sum += String(call(/\d/, question)).length;
    }
    console.log(sum, texts.map(text => steps.map(step => call(text, step)).join("|")).join(" / "));
  `,
};

test("the everyday methods of a text, found by a call whose callee the build cannot tell, do not go through the engine's host functions", async () => {
  using dir = tempDir("aot-methods-of-texts-by-name", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });

  const path = join(String(dir), "counts");
  const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
  const plain = await run([bunExe(), "main.mjs"], String(dir), bunEnv);
  expect(await run([executable], String(dir), env)).toEqual({ stdout: plain.stdout, stderr: "", exitCode: 0 });
  const counts = new Map<string, number>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [count, name] = line.split("\toperation:");
    if (name) counts.set(name, (counts.get(name) ?? 0) + Number(count));
  }
  const calls = turns + 3;
  expect({
    includes: counts.get("operationAOTStringIncludes"),
    endsWith: counts.get("operationAOTStringEndsWith"),
    splitAtText: counts.get("operationAOTStringSplitString"),
    splitAtPattern: counts.get("operationAOTStringSplitRegExp"),
    replaceText: counts.get("operationAOTStringReplaceString"),
    replaceByFunction: counts.get("operationAOTStringReplaceRegExpWithFunction"),
  }).toEqual({
    includes: calls,
    endsWith: calls,
    splitAtText: calls,
    splitAtPattern: calls,
    replaceText: calls,
    replaceByFunction: 2 * calls,
  });
});

const project = {
  "app.js": `
    export const use = (text, pattern) => [
      text.replace(pattern, "<$&>"), text.split(pattern).join("|"), String(text.match(pattern)), pattern.test(text), String(pattern.exec(text)), pattern.lastIndex,
    ].join(" ");`,
  "one.test.js": `
    import { expect, spyOn, test } from "bun:test";
    import { use } from "./app";
    const own = { replace: () => "own", split: () => ["own"], match: () => "own", test: () => "own", exec: () => "own", lastIndex: "own" };
    const uses = () => [use("a1b22c", /\\d+/), use("a1b22c", /\\d+/g), use(own, own), use("none", /\\d/), use("a1b22c", own), use(own, /\\d/)].join(" ; ");
    test("a method of RegExp.prototype that a test replaces is what every match calls", () => {
      console.log(uses());
      const executed = spyOn(RegExp.prototype, "exec");
      console.log(uses());
      console.log(executed.mock.calls.length, executed.mock.calls.map(call => call[0]).join(","));
      executed.mockImplementation(() => null);
      console.log(uses());
      executed.mockRestore();
      console.log(uses());
      const tested = spyOn(RegExp.prototype, "test").mockImplementation(() => "replaced");
      console.log(uses(), tested.mock.calls.length);
      tested.mockRestore();
      console.log(uses());
    });`,
};

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout, results, exitCode };
}

test("where a test file replaces a method of RegExp.prototype, a call by name finds what plain Bun finds", async () => {
  using dir = tempDir("aot-replaced-methods-of-patterns", project);
  const plain = await runTests(String(dir));
  expect(plain.results).toEqual(["pass a method of RegExp.prototype that a test replaces is what every match calls"]);
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
});

async function sharedCodeOf(program: string) {
  using dir = tempDir("aot-code-that-matches", { "main.js": program });
  const mapPath = join(String(dir), "main.map");
  const built = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "./main.js",
      "--outfile",
      join(String(dir), isWindows ? "main.exe" : "main"),
    ],
    String(dir),
    { ...bunEnv, BUN_JSC_aotMapFilePath: mapPath },
  );
  expect(built.exitCode).toBe(0);
  return new Set(
    readFileSync(mapPath, "utf8")
      .split("\n")
      .map(line => line.split("\t"))
      .filter(fields => fields[0] === "T" && fields.length >= 3)
      .map(fields => fields[2].replace(/[.#( ].*/, "")),
  );
}

test("a program without a regular expression holds no code that matches one", async () => {
  const without = await sharedCodeOf("console.log(1);\n");
  expect(without.has("CallBoxedBuiltin")).toBe(true);
  expect(without.has("RegExpMatch")).toBe(false);
  expect(without.has("StringReplaceRegExpMayNotMatch")).toBe(false);
  const withOne = await sharedCodeOf("console.log(process.argv.map(text => text.replace(/a/, 'b')).length);\n");
  expect(withOne.has("StringReplaceRegExpMayNotMatch")).toBe(true);
  expect(withOne.has("RegExpMatch")).toBe(true);
  const evaluated = await sharedCodeOf("console.log((0, eval)(process.argv[2] ?? '1'));\n");
  expect(evaluated.has("RegExpMatch")).toBe(true);
});
