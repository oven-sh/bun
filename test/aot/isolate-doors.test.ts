import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
// One by one: a case builds for minutes, and beside others it would pass its limit where Bun has a sanitizer.
import { testOneByOne as test } from "./supported";

// `--isolate` gives every test file a realm of its own, and each realm runs the compiled program anew. An object can still get from one
// file to the next: `Bun.s3` is one object for the process, and with `--isolate=modules` the global object stays, so whatever hangs on
// `process.versions` or on a built-in module stays too. Such an object has the shape that the later file's own objects have, and is none of
// them: its class, its private names and its methods are the earlier file's. Each side uses the other's object here, and every line is as in `bun test`.

const files = {
  "package.json": `{ "name": "isolate-doors" }`,
  "lib.ts": `
export class Box {
  #secret = 1;
  value = 7;
  static made = 0;
  constructor() { Box.made++; }
  get() { return this.value + Box.made; }
  secret() { return this.#secret; }
  static is(x: unknown) { return typeof x === "object" && x !== null && #secret in x; }
}
export const describeBox = (x: any) => {
  const tried = (read: () => unknown) => { try { return String(read()); } catch (error) { return (error as Error).constructor.name; } };
  return [x instanceof Box, Box.is(x), x.value, tried(() => x.get()), tried(() => Box.prototype.get.call(x)), tried(() => Box.prototype.secret.call(x))].join(" ");
};
`,
  "doors.ts": `
import { createRequire } from "node:module";
import * as fs from "node:fs";
const require = createRequire(import.meta.url);
export const doors: Record<string, any> = {
  "Bun.s3": Bun.s3,
  "process.versions": process.versions,
  "process.execArgv": process.execArgv,
  "process.stdout": process.stdout,
  "node:fs": require("node:fs"),
  "fs.promises": fs.promises,
};
`,
  "a.test.ts": `
import { test } from "bun:test";
import { Box, describeBox } from "./lib";
import { doors } from "./doors";
test("puts", () => {
  new Box();
  for (const door of Object.values(doors)) door.kept = { box: new Box(), describeBox };
});
`,
  "b.test.ts": `
import { test } from "bun:test";
import { Box, describeBox } from "./lib";
import { doors } from "./doors";
test("uses", () => {
  for (const [name, door] of Object.entries(doors)) {
    const kept = door.kept;
    console.log("DOOR " + name + ": " + (kept ? "theirs here: " + describeBox(kept.box) + " | ours there: " + kept.describeBox(new Box()) : "nothing"));
  }
  console.log("DOOR own: " + describeBox(new Box()));
});
`,
};

async function doorsOf(dir: string, flags: string[], words?: string) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "./a.test.ts", "./b.test.ts"], dir, env);
  const lines = (stdout + stderr).split("\n").filter(line => line.startsWith("DOOR "));
  return { exitCode, lines, stderr: exitCode ? stderr : "" };
}

const modes = [
  { isolate: "--isolate", openDoors: 1, forms: ["TestRunLayers:0", "TestRunLayers:2"] },
  // TODO(4271): as one program a compiled run with --isolate=modules gives each file a global object of its own: five of the six doors are shut.
  { isolate: "--isolate=modules", openDoors: 6, forms: ["TestRunLayers:2"] },
];

test.each(modes)(
  "$isolate: an object of an earlier test file is used as in bun test",
  async ({ isolate, openDoors, forms }) => {
    using dir = tempDir("aot-isolate-doors", files);
    const [plain, ...compiled] = await Promise.all([
      doorsOf(String(dir), [isolate]),
      ...forms.map(form => doorsOf(String(dir), [isolate, "--aot"], form)),
    ]);
    expect(plain.exitCode).toBe(0);
    // A door that has shut tests nothing.
    expect(plain.lines.filter(line => line.includes("theirs here: false false 7")).length).toBe(openDoors);
    for (const run of compiled) expect(run).toEqual(plain);
  },
  240_000,
);

test.todo("--isolate=modules as one program");
