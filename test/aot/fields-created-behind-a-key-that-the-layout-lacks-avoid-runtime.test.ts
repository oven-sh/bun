import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const turns = 2000;
const numberOfKinds = 12;

// One constructor at the root of twelve kinds of objects. Between its stores by name stands one under a key that only the run knows, so the object keeps that property beside its fields.
const program = (key: string, atTheEnd: string, storeUnderKey = "this[key] = false;") => `
var key = ${key};
function Root(limit) {
  this.events = null;
  this.eventsCount = 0;
  ${storeUnderKey}
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
let last;
for (let turn = 0; turn < ${turns}; turn++) {
  for (const Kind of kinds) {
    last = new Kind(10);
    sum += last.late + last.maxListeners;
  }
}
console.log(sum${atTheEnd});
`;

const symbol = `Symbol("first");\nif (process.argv.length > 5) key = Symbol("never")`;
const text = `JSON.parse('"mode"')`;
const programs: Record<string, { source: string; answer: string }> = {
  "a-symbol.mjs": { source: program(symbol, ""), answer: "" },
  "a-text.mjs": { source: program(text, ""), answer: "" },
  "no-such-key.mjs": { source: program(text, "", ""), answer: "" },
  "a-symbol-and-the-keys-are-listed.mjs": {
    source: program(symbol, `, Reflect.ownKeys(last).map(String).join()`),
    answer: " early,events,eventsCount,maxListeners,late,Symbol(first)",
  },
  "a-text-and-the-keys-are-listed.mjs": {
    source: program(text, `, Object.keys(last).join()`),
    answer: " early,events,eventsCount,mode,maxListeners,late",
  },
};

test.each(Object.keys(programs))(
  "a field that is created behind such a key is listed without a call: %s",
  async entry => {
    using dir = tempDir("aot-fields-created-behind-a-key", { [entry]: programs[entry].source });
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", executable], String(dir));
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const counts = join(String(dir), "counts.txt");
    const ran = await run([executable], String(dir), { ...bunEnv, [runtimeEnvironment.countsPath]: counts });
    expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(ran.stdout).toBe(`${turns * (66 + 10 * numberOfKinds)}${programs[entry].answer}\n`);
    let timesAsked = 0;
    for (const line of readFileSync(counts, "utf8").split("\n")) {
      const [times, what] = line.split("\t");
      if (what?.startsWith("operation:operationAOTDidCreateField")) timesAsked += Number(times);
    }
    // Where nobody lists the keys there is no order to keep, so not even the first object of a kind asks.
    if (programs[entry].answer === "") expect(timesAsked).toBe(0);
    else expect(timesAsked).toBeLessThan(turns / 10);
  },
  240_000,
);
