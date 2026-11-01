import { expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// `/x/.test(text)`: the pattern is evaluated ahead of the read of `test`. Where a test file replaces RegExp.prototype.test, the built-in takes the pattern on one arm and a call does on the other.
const app = {
  "app.ts": `
    export function hasDigit(text: string): boolean { return /\\d/.test(text); }
    export function hasDigitUntyped(text) { return /\\d/.test(text); }
    export function firstWord(text: string): string | undefined { return /(\\w+)/.exec(text)?.[1]; }
    export function nextDigit(text: string): boolean { return /\\d/g.test(text); }
    export function twice(a: string, b: string): number {
      const pattern = /\\d/;
      return (pattern.test(a) ? 1 : 0) + (pattern.test(b) ? 2 : 0);
    }
    export function everyOne(texts: string[]): number {
      const pattern = /\\d/;
      let count = 0;
      for (const text of texts) if (pattern.test(text)) count++;
      return count;
    }
    export function either(text: string, first: boolean): boolean {
      const pattern = /\\d/;
      if (first) return pattern.test(text);
      return pattern.test(text + "1");
    }
    export function inEveryTurn(texts: string[]): number {
      let count = 0;
      for (const text of texts) if (/\\d/.test(text)) count++;
      return count;
    }`,
};
const imports = `
  import { expect, spyOn, test } from "bun:test";
  import { either, everyOne, firstWord, hasDigit, hasDigitUntyped, inEveryTurn, nextDigit, twice } from "./app";`;

async function runTests(directory: string, environment: Record<string, string | undefined>, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, environment);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout, results, exitCode };
}

test("what replaces the method gets the objects that plain Bun hands it", async () => {
  using dir = tempDir("patterns-in-place", {
    ...app,
    "one.test.ts": `${imports}
      const uses = () => [
        hasDigit("a1"), hasDigit("a"), hasDigitUntyped("2"), hasDigitUntyped(undefined), firstWord(" ab c"), nextDigit("1a"), nextDigit("1a"),
        twice("1", "b"), twice("a", "2"), everyOne(["1", "b", "3"]), either("a", true), either("a", false), inEveryTurn(["1", "b", "3"]),
      ].join(" ");
      test("every evaluation has an object of its own, and one evaluation has one", () => {
        console.log(uses());
        const seen: RegExp[] = [];
        const original = RegExp.prototype.test;
        const tested = spyOn(RegExp.prototype, "test").mockImplementation(function (this: RegExp, text: string) {
          // What an earlier call left on the object is there again only where the program names the same object.
          const marks = ((this as any).marks = ((this as any).marks ?? 0) + 1);
          seen.push(this);
          console.log("test", this.source, this.flags, this.lastIndex, marks, seen.indexOf(this), String(text));
          this.lastIndex = 7;
          return original.call(new RegExp(this.source, this.flags), text);
        });
        const executed = spyOn(RegExp.prototype, "exec");
        console.log(uses());
        console.log(tested.mock.calls.length, executed.mock.calls.length, new Set(seen).size, new Set(executed.mock.contexts).size);
        tested.mockRestore();
        executed.mockRestore();
        console.log(uses());
      });`,
  });
  const plain = await runTests(String(dir), bunEnv);
  expect(plain.results).toEqual(["pass every evaluation has an object of its own, and one evaluation has one"]);
  expect(await runTests(String(dir), bunEnv, "--aot")).toEqual(plain);
});

// RegExp.prototype.exec stays as it is here: where it may be replaced too, the built-in `test` has to ask the object for it.
test("while nothing is replaced no object is made", async () => {
  using dir = tempDir("patterns-in-place-counted", {
    ...app,
    "one.test.ts": `${imports}
      test("many evaluations", () => {
        let count = 0;
        for (let i = 0; i < 100000; i++) {
          const text = i & 1 ? "a" + i : "b";
          count += (hasDigit(text) ? 1 : 0) + (hasDigitUntyped(text) ? 1 : 0) + (firstWord(text) ? 1 : 0) + (either(text, !(i & 2)) ? 1 : 0) + inEveryTurn([text, "c"]);
        }
        expect(count).toBe(325000);
      });
      test("replaced for a while", () => {
        using tested = spyOn(RegExp.prototype, "test");
        expect(hasDigit("1") && firstWord("a") === "a").toBe(true);
        expect(tested).toHaveBeenCalledTimes(1);
      });`,
  });
  const { results } = await runTests(
    String(dir),
    { ...bunEnv, BUN_JSC_aotCountsPath: join(String(dir), "counts.%p") },
    "--aot",
  );
  expect(results).toEqual(["pass many evaluations", "pass replaced for a while"]);
  let cells = 0;
  for (const name of readdirSync(String(dir)).filter(name => name.startsWith("counts."))) {
    for (const line of readFileSync(join(String(dir), name), "utf8").split("\n")) {
      const found = /^refill .* RegExpObject:\d+ (\d+) \d+$/.exec(line);
      if (found) cells += Number(found[1]);
    }
  }
  // 600,000 evaluations. One block of the allocator holds some hundreds of cells.
  expect(cells).toBeLessThan(5000);
});
