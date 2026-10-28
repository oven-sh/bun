import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const turns = 2000;
const numberOfKinds = 12;

// Twelve kinds of objects that hold a symbol beside the names that their constructors give them. Every object is asked for its own keys once.
const program = (list: string) => `
var key = Symbol("first");
if (process.argv.length > 5) key = Symbol("never");
function Root(limit) {
  this.events = null;
  this.eventsCount = 0;
  this[key] = false;
  this.maxListeners = limit;
}
const library = { Root: function Unused() {} };
library.Root = Root;
const kinds = [];
for (let i = 0; i < ${numberOfKinds}; i++) {
  const Kind = { ["Kind" + i]: function (limit) { if (i & 1) this.early = i; library.Root.call(this, limit); this.late = i; } }["Kind" + i];
  Object.setPrototypeOf(Kind.prototype, Root.prototype);
  kinds.push(Kind);
}
let sum = 0;
for (let turn = 0; turn < ${turns}; turn++) {
  for (const Kind of kinds) sum += ${list}(new Kind(10)).length;
}
console.log(sum);
`;

const programs: Record<string, { source: string; keysATurn: number }> = {
  "own-keys.mjs": { source: program("Reflect.ownKeys"), keysATurn: 5 * numberOfKinds + numberOfKinds / 2 },
  "own-property-names.mjs": {
    source: program("Object.getOwnPropertyNames"),
    keysATurn: 4 * numberOfKinds + numberOfKinds / 2,
  },
};

test.each(Object.keys(programs))(
  "the strings of a list of keys are made for the first objects of a kind and shared by the others: %s",
  async entry => {
    using dir = tempDir("aot-own-keys-beside-a-symbol", { [entry]: programs[entry].source });
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", executable], String(dir));
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const counts = join(String(dir), "counts.txt");
    const ran = await run([executable], String(dir), { ...bunEnv, [runtimeEnvironment.countsPath]: counts });
    expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(Number(ran.stdout)).toBe(turns * programs[entry].keysATurn);
    let stringsMade = 0;
    for (const line of readFileSync(counts, "utf8").split("\n")) {
      const [kind, , place, what, cells] = line.split(" ");
      if (kind === "refill" && place.startsWith(entry + ":") && what.startsWith("JSString:"))
        stringsMade += Number(cells);
    }
    expect(stringsMade).toBeLessThan((turns * programs[entry].keysATurn) / 10);
  },
  240_000,
);
