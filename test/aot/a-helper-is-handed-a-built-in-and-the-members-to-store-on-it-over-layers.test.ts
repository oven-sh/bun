// A helper of a test suite saves and restores: `swap(Date, { now: () => 5 })`, where helpers.js holds
// `export function swap(target, members) { for (const name in members) { saved[name] = target[name]; target[name] = members[name]; } .. }`.
// As one program the build follows the object and the names into the helper. Over layers the run has to know which members its tests replace before the first build, from a look at each file
// by itself. That look took a text beside a built-in for the name of a member, `stub(Date, "now")`, and not the keys of a literal beside one:
// "TypeError: Cannot assign to Date.now because built-in objects are read-only in compiled code, and the build didn't see a test replace this one".
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const helpers = `
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
      import { assign, Stub, swap } from "./helpers.js";
      import { folder, joined, keys, now, parsed, random } from "../src/app.js";
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
