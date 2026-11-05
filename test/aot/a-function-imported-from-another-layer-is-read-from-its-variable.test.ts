import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(240_000);

// In a test run an exported function is a variable, because a spy may replace it, and the variable's word is empty until something is stored to it: every reader takes an empty word
// for the one closure of the function. A test file reads what it imports from a layer below through a stub that knows the word alone. It found the word empty at every read
// and went the whole way through the namespace object, 2,000 instructions for each call of an imported function.
const files = {
  "package.json": `{ "name": "imported-functions", "type": "module" }`,
  "src/values.ts": `
    export function one(): number { return 1; }
    export function two(): number { return 2; }
    export function three(): number { return 3; }
    export function four(): number { return 4; }
    export function callsOne(): number { return one(); }
    export class Kept { static made(): string { return "Kept"; } }
    export class Counted {
      static total = 1;
      static label = "counted";
      static list: number[] = [1];
      static later: number | undefined;
      static add(n: number): number { return (Counted.total += n); }
    }
    export class Below extends Counted { static own = 7; }
    export let counter = 0;
    export function count(): number { return ++counter; }`,
  "src/again.ts": `
    export * from "./values";
    export { one as first, three as third } from "./values";`,
  "reads.test.ts": `
    import { expect, mock, spyOn, test } from "bun:test";
    import * as values from "./src/values";
    import * as again from "./src/again";
    import { Below, callsOne, count, Counted, counter, Kept, one, three, two } from "./src/values";
    import { first, third } from "./src/again";
    const say = (...words: unknown[]) => console.log("SAID " + words.join(" "));
    test("the functions are the same by every road, before and after a spy", () => {
      const held = one;
      say(one(), two(), values.one(), again.one(), first(), callsOne(), Kept.made(), count(), counter);
      say(one === values.one, one === again.one, one === first, held === one, typeof two, two.name, two.length);
      const spy = spyOn(values, "one").mockImplementation(() => 10);
      say(one(), values.one(), again.one(), first(), callsOne(), held(), one === held, spy.mock.calls.length);
      spy.mockRestore();
      say(one(), values.one(), again.one(), first(), callsOne(), held(), one === held);
      const other = spyOn(values, "two");
      say(two(), values.two(), other.mock.calls.length, two === values.two);
      mock.restore();
      say(two(), values.two(), two === values.two, count(), counter);
    });
    test("a loop that reads and calls two that nothing was ever stored to", () => {
      let sum = 0;
      for (let i = 0; i < 20000; i++) sum += three() + values.four() + (third === three ? 1 : 0);
      say(sum);
    });
    test("the static fields of their classes, read often, between what changes them", () => {
      const read = () => {
        let total = 0, text = "";
        for (let i = 0; i < 400; i++) {
          total += Counted.total + values.Counted.total + Below.total + Below.own + Counted.list.length + (Counted.later ?? 0);
          text = Counted.label;
        }
        return total + " " + text + " " + Object.keys(Counted).join();
      };
      say(read());
      say(Counted.add(2), read());
      Counted.total = 10;
      Counted.later = 3;
      say(Counted.add(1), read());
      Below.total = 100;
      say(Counted.total, Below.total, read());
      Object.defineProperty(Counted, "total", { get: () => 1000, configurable: true });
      say(Counted.total, read());
      delete (Counted as any).total;
      say(Counted.total, read());
      Counted.total = 5;
      (Counted as any).label = 6;
      Counted.list = [];
      say(Counted.add(1), read());
      const spy = spyOn(Counted, "add").mockImplementation(() => -1);
      say(Counted.add(1), values.Counted.add(1), read());
      spy.mockRestore();
      say(Counted.add(1), read());
    });
    test("a read of a function against a read of a variable", () => {
      const leastOf = (read: () => number) => {
        let least = Infinity;
        for (let round = 0; round < 9; round++) {
          const before = Bun.nanoseconds();
          read();
          least = Math.min(least, Bun.nanoseconds() - before);
        }
        return least;
      };
      const held: unknown = [three][0];
      const ofVariable = leastOf(() => {
        let sum = 0;
        for (let i = 0; i < 20000; i++) sum += counter + values.counter;
        return sum;
      });
      const ofFunction = leastOf(() => {
        let sum = 0;
        for (let i = 0; i < 20000; i++) sum += (three === held ? 1 : 0) + (values.three === held ? 1 : 0);
        return sum;
      });
      const ofStaticField = leastOf(() => {
        let sum = 0;
        for (let i = 0; i < 20000; i++) sum += Below.own + values.Below.own;
        return sum;
      });
      console.log("TIMES " + (ofFunction / ofVariable).toFixed(2) + " " + (ofStaticField / ofVariable).toFixed(2));
    });`,
  "other.test.ts": `
    import { test } from "bun:test";
    import { two } from "./src/values";
    test("another file has functions of its own realm", () => console.log("SAID " + two()));`,
};

async function runIn(words: string | undefined, ...flags: string[]) {
  using dir = tempDir("aot-imported-functions", files);
  const env = {
    ...bunEnv,
    BUN_DEBUG_TEST_AOT_WORDS: words,
  };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
  const failed = stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic/.test(line));
  const said = stdout
    .split("\n")
    .filter(line => line.startsWith("SAID"))
    .sort();
  const times = (/^TIMES (.*)$/m.exec(stdout)?.[1] ?? "").split(" ").map(Number);
  return { said, failed, exitCode, times };
}

test("it says what plain Bun says, as one program and in layers, and a function is read about as fast as a variable", async () => {
  const [plain, one, shared, layers] = await Promise.all([
    runIn(undefined),
    runIn("TestRunLayers:0", "--aot"),
    runIn("TestRunLayers:1,TestRunPartFiles:1", "--aot"),
    runIn("TestRunLayers:2,TestRunPartFiles:1", "--aot"),
  ]);
  expect(plain.failed).toEqual([]);
  expect(plain.said.length).toBe(17);
  expect(plain.said).toContain("SAID 160000");
  for (const compiled of [one, shared, layers]) expect({ ...compiled, times: [] }).toEqual({ ...plain, times: [] });
  // 30 times a variable where every read went through the namespace object.
  // A static field is two reads, of the class and of the field: 22 times where the second one was never filed.
  for (const { times } of [shared, layers]) {
    expect(times.length).toBe(2);
    expect(Math.max(...times)).toBeLessThan(8);
  }
});
