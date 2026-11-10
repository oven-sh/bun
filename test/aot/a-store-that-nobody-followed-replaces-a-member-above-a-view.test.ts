// In a test run a member of a built-in that only a store which the build could not follow may have replaced is believed to be what the engine made, behind tests at run time: whether the
// receiver itself is as its class made it, one byte of the member, which the store sets, and one byte of each holder that lies below the member, which a name laid there sets. Each case really replaces the member, by way of values that the build knows nothing of, at another moment:
// what the code under test sees is what it sees under `bun test`.
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
export function countWhile(view: Int32Array, between: (at: number) => void): number {
  let total = 0;
  for (let at = 0; at < view.length; at += 1) {
    between(at);
    total += 1;
  }
  return total;
}
export function size(view: Int32Array): number {
  return view.length;
}
`;

const loose = `
export function find(path: string): any {
  let found: any = globalThis;
  for (const name of JSON.parse(path)) found = name === "^" ? Object.getPrototypeOf(found) : found[name];
  return found;
}
export function lay(holder: any, name: any, getter: any): any {
  const original = Object.getOwnPropertyDescriptor(holder, name);
  Object.defineProperty(holder, name, { configurable: true, get: getter });
  return original;
}
export function putBack(holder: any, name: any, original: any): void {
  if (original) Object.defineProperty(holder, name, original);
  else delete holder[name];
}
export function wipe(list: any): void {
  list.length = 0;
}
`;

const head = `import { afterAll, beforeAll, spyOn, test } from "bun:test";
import { count, countWhile, size } from "./product";
import { find, lay, putBack, wipe } from "./loose";
const say = (...seen: unknown[]) => console.error("SEEN " + seen.join(" "));
const above = () => find('["Int32Array", "prototype", "^"]');
const name = () => JSON.parse('"length"');
wipe(JSON.parse("[1]"));
`;

const cases: Record<string, { files: Record<string, string>; seen: string[] }> = {
  "nobody writes": {
    files: { "a.test.ts": `${head}test("t", () => { say(count(new Int32Array(3)), size(new Int32Array(4))); });` },
    seen: ["SEEN 3 4"],
  },
  "in front of the uses": {
    files: {
      "a.test.ts": `${head}test("t", () => {
  const original = lay(above(), name(), () => 7);
  say(count(new Int32Array(3)), size(new Int32Array(4)));
  putBack(above(), name(), original);
  say(count(new Int32Array(3)), size(new Int32Array(4)));
});`,
    },
    seen: ["SEEN 7 7", "SEEN 3 4"],
  },
  "between the uses": {
    files: {
      "a.test.ts": `${head}test("t", () => {
  const view = new Int32Array(3);
  say(count(view), size(view));
  const original = lay(above(), name(), () => 7);
  say(count(view), size(view));
  putBack(above(), name(), original);
  say(count(view), size(view));
});`,
    },
    seen: ["SEEN 3 3", "SEEN 7 7", "SEEN 3 3"],
  },
  "behind the uses": {
    files: {
      "a.test.ts": `${head}test("t", () => {
  const view = new Int32Array(3);
  say(count(view), size(view));
  putBack(above(), name(), lay(above(), name(), () => 7));
  say(count(view), size(view));
});`,
    },
    seen: ["SEEN 3 3", "SEEN 3 3"],
  },
  "between two turns of the loop": {
    files: {
      "a.test.ts": `${head}test("t", () => {
  let original: any;
  say(countWhile(new Int32Array(3), at => { if (at === 1) original = lay(above(), name(), () => 5); }));
  putBack(above(), name(), original);
  say(countWhile(new Int32Array(3), () => {}));
});`,
    },
    seen: ["SEEN 5", "SEEN 3"],
  },
  "on one instance": {
    files: {
      "a.test.ts": `${head}test("t", () => {
  const view = new Int32Array(3), other = new Int32Array(3);
  lay(view, name(), () => 7);
  say(count(view), size(view), count(other), size(other));
});`,
    },
    seen: ["SEEN 7 7 3 3"],
  },
  "a name laid on the prototype of the class itself, below the member": {
    files: {
      "a.test.ts": `${head}test("t", () => {
  const view = new Int32Array(3);
  say(count(view), size(view));
  Object.defineProperty(Int32Array.prototype, "length", { configurable: true, get: () => 7 });
  say(count(view), size(view), count(new Uint8Array(2) as any));
  delete (Int32Array.prototype as any).length;
  say(count(view), size(view));
});`,
    },
    seen: ["SEEN 3 3", "SEEN 7 7 2", "SEEN 3 3"],
  },
  "a name laid on the prototype of the class, which the test file has lost in a list": {
    files: {
      "a.test.ts": `${head}const holders: any[] = [Int32Array.prototype, Float64Array.prototype];
function layOn(at: number) { Object.defineProperty(holders[at], "length", { configurable: true, get: () => 7 }); }
function dropFrom(at: number) { delete holders[at].length; }
test("t", () => {
  const view = new Int32Array(3);
  say(count(view), size(view));
  layOn(JSON.parse("0"));
  say(count(view), size(view), count(new Uint8Array(2) as any));
  dropFrom(JSON.parse("0"));
  say(count(view), size(view));
});`,
    },
    seen: ["SEEN 3 3", "SEEN 7 7 2", "SEEN 3 3"],
  },
  "the member is deleted": {
    files: {
      "a.test.ts": `${head}test("t", () => {
  const view = new Int32Array(3), original = Object.getOwnPropertyDescriptor(above(), name());
  say(count(view), size(view));
  delete above()[name()];
  say(count(view), size(view));
  putBack(above(), name(), original);
  say(count(view), size(view));
});`,
    },
    seen: ["SEEN 3 3", "SEEN 0 ", "SEEN 3 3"],
  },
  "in another file of the run": {
    files: {
      "a.test.ts": `${head}let original: any;
beforeAll(() => { original = lay(above(), name(), () => 7); });
afterAll(() => { putBack(above(), name(), original); });
test("t", () => { say(count(new Int32Array(3))); });`,
      "b.test.ts": `${head}test("t", () => { say(count(new Int32Array(3))); });`,
    },
    seen: ["SEEN 7", "SEEN 3"],
  },
  "a spy that is restored": {
    files: {
      "a.test.ts": `${head}test("t", () => {
  const spy = spyOn(above(), name(), "get").mockReturnValue(7);
  say(count(new Int32Array(3)), spy.mock.calls.length > 0);
  spy.mockRestore();
  say(count(new Int32Array(3)));
});`,
    },
    seen: ["SEEN 7 true", "SEEN 3"],
  },
};

for (const [title, { files, seen }] of Object.entries(cases))
  test.concurrent(title, async () => {
    using dir = tempDir("aot-watch-above-views", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "product.ts": product,
      "loose.ts": loose,
      ...files,
    });
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
      return { seen: (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
    };
    expect(await seenWith()).toEqual({ seen, exitCode: 0 });
    expect(await seenWith("--aot")).toEqual({ seen, exitCode: 0 });
  });
