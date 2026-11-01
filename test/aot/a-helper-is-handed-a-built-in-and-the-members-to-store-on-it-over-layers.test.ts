// A helper of a test suite saves and restores: `swap(Date, { now: () => 5 })`, where helpers.js holds
// `export function swap(target, members) { for (const name in members) { saved[name] = target[name]; target[name] = members[name]; } .. }`.
// As one program the build follows the object and the names into the helper. Over layers the run has to know which members its tests replace before the first build, from a look at each file
// by itself. That look took a text beside a built-in for the name of a member, `stub(Date, "now")`, and not the keys of a literal beside one:
// "TypeError: Cannot assign to Date.now because built-in objects are read-only in compiled code, and the build didn't see a test replace this one".
// And where only the run knows the names, `silence(console, levels())`: a file that writes on what a parameter holds under a name which nothing in it spells, and a file that passes it a
// built-in, open every member of that built-in, as a loop in the test file itself does. A spy in such a helper was refused as one program too.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const helpers = `
import { spyOn } from "bun:test";
export function silence(target, names) {
  for (const name of names) target[name] = () => "silent";
}
export const spyAll = (target, wanted) => Object.keys(target).filter(wanted).map(name => spyOn(target, name));
export function defineUnder(target, key, value) {
  Object.defineProperty(target, key, { value, writable: true, configurable: true });
}
export function swap(target, members) {
  const saved = {};
  for (const name in members) {
    saved[name] = target[name];
    target[name] = members[name];
  }
  return () => {
    for (const name in saved) target[name] = saved[name];
  };
}
export const assign = (target, members) => Object.assign(target, members);
export class Stub {
  constructor(target, members) {
    this.restore = swap(target, members);
  }
}
`;

// The code under test calls the members in a file of its own.
const app = `
export const now = () => Date.now();
export const random = () => Math.random();
export const parsed = text => JSON.parse(text);
export const folder = () => process.cwd();
export const keys = object => Object.keys(object);
export const joined = list => list.join("-");
export const largest = (a, b) => Math.max(a, b);
export const report = text => console.debug(text);
`;

const ways = {
  "the literal stands in the call": `
    const restore = swap(Date, { now() { return 5; } });
    console.error("OUT", now());
    restore();
    console.error("OUT", typeof now(), now() === 5);`,
  "the literal stands in a constant": `
    const members = { random: () => 0.25, ["max"]: () => 7 };
    const restore = swap(Math, members);
    console.error("OUT", random(), Math.max(1, 2));
    restore();
    console.error("OUT", random() === 0.25, Math.max(1, 2));`,
  "several built-ins, one behind the other": `
    const restores = [swap(JSON, { parse: () => "parsed" }), swap(process, { cwd: () => "/nowhere" }), swap(Object, { keys: () => ["k"] })];
    console.error("OUT", parsed("1"), folder(), keys({ a: 1 }).join());
    for (const restore of restores) restore();
    console.error("OUT", parsed("1"), folder() === "/nowhere", keys({ a: 1 }).join());`,
  "a prototype": `
    const restore = swap(Array.prototype, { join() { return "joined " + this.length; } });
    console.error("OUT", joined(["a", "b"]));
    restore();
    console.error("OUT", joined(["a", "b"]));`,
  "Object.assign in the helper": `
    const before = Date.now;
    assign(Date, { now: () => 6 });
    console.error("OUT", now());
    assign(Date, { now: before });
    console.error("OUT", now() === 6);`,
  "names that only the run knows": `
    const saved = { max: Math.max, min: Math.min };
    silence(Math, (process.env.NO_SUCH_SETTING ?? "max,min").split(","));
    console.error("OUT", largest(1, 2), Math.min(1, 2));
    Object.assign(Math, saved);
    console.error("OUT", largest(1, 2), Math.min(1, 2));`,
  "spies under names that the helper works out": `
    const spies = spyAll(console, name => name === "debug" || name === "table");
    for (const spy of spies) spy.mockImplementation(() => {});
    report("a");
    console.error("OUT", spies.map(spy => spy.mock.calls.length).join());
    for (const spy of spies) spy.mockRestore();
    console.error("OUT", spies.length);`,
  "defined under a name that only the run knows": `
    const before = Date.now;
    defineUnder(Date, (process.env.NO_SUCH_SETTING ?? "now,x").split(",")[0], () => 8);
    console.error("OUT", now());
    defineUnder(Date, "now", before);
    console.error("OUT", now() === 8);`,
  "a class of the helpers": `
    const stub = new Stub(Date, { now: () => 7 });
    console.error("OUT", now());
    stub.restore();
    console.error("OUT", now() === 7);`,
};

async function linesOf(body: string, flags: string[]) {
  using dir = tempDir("aot-helper-is-handed-members", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/app.js": app,
    "test/helpers.js": helpers,
    "test/a.test.js": `
      import { test } from "bun:test";
      import { assign, defineUnder, silence, spyAll, Stub, swap } from "./helpers.js";
      import { folder, joined, keys, largest, now, parsed, random, report } from "../src/app.js";
      test("t", () => {${body}
      });`,
    "test/b.test.js": `import { test } from "bun:test";\nimport { now } from "../src/app.js";\ntest("u", () => { console.error("OUT", typeof now()); });`,
  });
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return {
    lines: stderr
      .split("\n")
      .filter(line => /^(OUT|error|TypeError)/.test(line))
      .sort(),
    exitCode,
  };
}

test.concurrent.each(Object.entries(ways))(
  "%s",
  async (_, body) => {
    const plain = await linesOf(body, []);
    expect(plain.exitCode).toBe(0);
    expect(plain.lines.length).toBe(3);
    expect(await linesOf(body, ["--aot"])).toEqual(plain);
    // More source than fits the memory as one program: the run is built in layers.
    expect(await linesOf(body, ["--aot", "--parallel=2", "--aot-memory-limit=1KB"])).toEqual(plain);
  },
  240_000,
);
