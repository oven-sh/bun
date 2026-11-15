// %TypedArray%.prototype hangs under no name of the global object. In a test run its members are constants in the code where nobody writes them (`view.length` is one load), and a test that
// replaces one, however it comes to the prototype and to the name, finds its replacement called by the code under test, as under `bun test`.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const product = `
export function count(view: Int32Array): number {
  let total = 0;
  for (let at = 0; at < view.length; at += 1) total += 1;
  return total;
}
export function part(view: Int32Array): number {
  return view.subarray(1, 3).length;
}
`;

const laid = (name: string) => `
  const above = Object.getPrototypeOf(Int32Array.prototype), name = ${name};
  const original = Object.getOwnPropertyDescriptor(above, name)!;
  Object.defineProperty(above, name, { configurable: true, get() { return 7; } });
  try {
    console.error("SEEN " + count(new Int32Array(3)));
  } finally {
    Object.defineProperty(above, name, original);
  }
  console.error("SEEN " + count(new Int32Array(3)));
`;

const cases: Record<string, { body: string; seen: string[] }> = {
  "nobody replaces anything": {
    body: `console.error("SEEN " + count(new Int32Array(3)) + " " + part(new Int32Array(5)));`,
    seen: ["SEEN 3 2"],
  },
  "a getter over length, spelled": { body: laid(`"length"`), seen: ["SEEN 7", "SEEN 3"] },
  "a getter over length, under a name made at run time": {
    body: laid(`["len", "gth"].join("")`),
    seen: ["SEEN 7", "SEEN 3"],
  },
  "a spy on subarray": {
    body: `
  const spy = spyOn(Object.getPrototypeOf(Int32Array.prototype), "subarray");
  console.error("SEEN " + part(new Int32Array(5)) + " " + spy.mock.calls.length);
  spy.mockRestore();
`,
    seen: ["SEEN 2 1"],
  },
};

for (const [title, { body, seen }] of Object.entries(cases))
  test.concurrent(title, async () => {
    using dir = tempDir("aot-views-prototype", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "product.ts": product,
      "a.test.ts": `import { spyOn, test } from "bun:test";
import { count, part } from "./product";
test("t", () => {${body}});
`,
    });
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
      return { seen: (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
    };
    expect(await seenWith()).toEqual({ seen, exitCode: 0 });
    expect(await seenWith("--aot")).toEqual({ seen, exitCode: 0 });
  });
