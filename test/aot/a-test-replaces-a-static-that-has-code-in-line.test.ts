// The engine has code in line for `Math.floor(x)`, `String.fromCodePoint(code)`, `Array.isArray(value)`, `Math.max(a, b)`. In a test run a test may replace them. Each case really replaces one, in another
// way, and the code under test calls the replacement, as under `bun test`. Held against a build in which the code in line was taken whatever lay under the name: six of the seven were red.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const product = `
export function whole(x) { return Math.floor(x); }
export function letter(code) { return String.fromCodePoint(code); }
export function isList(value) { return Array.isArray(value); }
export function sum(list) {
  let total = 0;
  for (let at = 0; at < list.length; at += 1) total += Math.floor(list[at]) + Math.max(list[at], 1);
  return total;
}
`;
const head = `import { mock, spyOn, test } from "bun:test";
import { isList, letter, sum, whole } from "./product.js";
const say = (...seen) => console.error("SEEN " + seen.join(" "));
const all = () => [whole(2.5), letter(65), isList([]), sum([1.5, 2.5])].join(",");
`;
const asMade = "2,A,true,7";

const cases: Record<string, { body: string; seen: string[] }> = {
  "nobody replaces anything": { body: `say(all());`, seen: [`SEEN ${asMade}`] },
  "plain assignment on the holder": {
    body: `const kept = Math.floor; say(all()); Math.floor = () => 7; say(all()); Math.floor = kept; say(all());`,
    seen: [`SEEN ${asMade}`, "SEEN 7,A,true,18", `SEEN ${asMade}`],
  },
  "a spy that answers otherwise": {
    body: `const spy = spyOn(String, "fromCodePoint").mockReturnValue("z"); say(all(), spy.mock.calls.length); spy.mockRestore(); say(all());`,
    seen: ["SEEN 2,z,true,7 1", `SEEN ${asMade}`],
  },
  "a mock laid on the holder": {
    body: `const kept = Array.isArray; Array.isArray = mock(() => false); say(all(), Array.isArray.mock.calls.length); Array.isArray = kept; say(all());`,
    seen: ["SEEN 2,A,false,7 1", `SEEN ${asMade}`],
  },
  "through a holder read off the global object under a name made at run time": {
    body: `const holder = globalThis[JSON.parse('"Math"')], name = JSON.parse('"max"'), kept = holder[name]; holder[name] = () => 100; say(all()); holder[name] = kept; say(all());`,
    seen: ["SEEN 2,A,true,203", `SEEN ${asMade}`],
  },
  "the holder itself is replaced on the global object": {
    body: `const kept = globalThis.Math; globalThis.Math = { floor: () => 9, max: () => 1 }; say(all()); globalThis.Math = kept; say(all());`,
    seen: ["SEEN 9,A,true,20", `SEEN ${asMade}`],
  },
  "between two turns of a loop": {
    body: `const kept = Math.max; const list = [1.5, { valueOf() { Math.max = () => 50; return 2.5; } }, 3.5]; say(sum(list)); Math.max = kept; say(all());`,
    seen: ["SEEN 107.5", `SEEN ${asMade}`],
  },
};

for (const [title, { body, seen }] of Object.entries(cases))
  test.concurrent(title, async () => {
    using dir = tempDir("aot-statics-in-line", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "product.js": product,
      "a.test.js": `${head}test("t", () => { ${body} });\n`,
    });
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
      return { seen: (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
    };
    expect(await seenWith()).toEqual({ seen, exitCode: 0 });
    expect(await seenWith("--aot")).toEqual({ seen, exitCode: 0 });
  });
