// `{ ...flag, state: false }`, where `flag` is an instance of a class whose `state` holds undefined: every name that the spread brings is listed by the record, so the record gains nothing, and its fields are filled at birth.
// The plan gave `state` a slot for a boolean alone. The spread's copy runs during the birth and lays undefined there before the literal's own false comes, and the executable stopped:
// "StoreOfOtherType .. the compiler proved that this never happens". Each program says what plain Bun says.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const programs: Record<string, string> = {
  "a-flag.js": `class Flag { constructor() { this.state = null; this.live = true; } }
function look(never) {
  const flag = new Flag(); flag.state = undefined;
  if (never) { const first = { z: 1, ...flag, live: null }; }
  const second = { ...flag, state: false };
  return String(second.state) + Object.keys(second).join("");
}
console.log(look(process.argv.length > 9));`,
  "two-cells.js": `class Cell { constructor() { this.left = undefined; this.right = null; } }
function pick(sel) {
  const one = new Cell(); const two = new Cell();
  if ((sel & 1) === 1) two.left = null;
  if ((sel >> 1 & 1) === 1) one.left = undefined;
  const copy = { z: 1, ...one, left: 0.5 };
  return String(copy.left) + "," + String(copy.right) + Object.keys(copy).join("");
}
for (let sel = 0; sel < 4; sel++) console.log(pick(sel + (process.argv.length > 9 ? 1 : 0)));`,
  "fields-of-the-class-body.js": `class Flag { state = null; live = true; }
function look() { const flag = new Flag(); flag.state = undefined; const copy = { ...flag, state: true }; return String(copy.state) + String(copy.live) + Object.keys(copy).join(""); }
console.log(look(), look());`,
  "three-copies.js": `class Flag { constructor() { this.state = undefined; this.count = null; this.name = null; } }
function look(turn) {
  const flag = new Flag();
  const first = { ...flag, state: false }; const second = { ...first, count: turn + 0.5 }; const third = { ...second, name: "n" + turn, state: true };
  return [first.state, first.count, second.state, second.count, second.name, third.state, third.count, third.name].join();
}
for (let turn = 0; turn < 3; turn++) console.log(look(turn));`,
  "what-a-getter-gives.js": `class Flag { constructor() { this.live = true; } }
function look(turn) {
  const flag = new Flag();
  Object.defineProperty(flag, "state", { get() { return turn & 1 ? undefined : null; }, enumerable: true });
  const copy = { ...flag, state: false };
  const other = { state: 0.5, ...flag };
  return String(copy.state) + String(other.state) + Object.keys(copy).join("") + Object.keys(other).join("");
}
for (let turn = 0; turn < 3; turn++) console.log(look(turn));`,
  "object-assign.js": `class Flag { constructor() { this.state = null; this.live = true; } }
function look() {
  const flag = new Flag(); flag.state = undefined;
  const copy = Object.assign({}, flag, { state: false });
  const onto = Object.assign({ state: 0.5, live: false }, flag);
  return String(copy.state) + String(onto.state) + String(onto.live) + Object.keys(copy).join("") + Object.keys(onto).join("");
}
console.log(look(), look());`,
  "read-back-and-tested.js": `class Flag { constructor() { this.state = undefined; this.share = null; } }
function look(turn) {
  const flag = new Flag(); if (turn === 2) flag.share = 3;
  const copy = { ...flag, state: turn > 0 };
  const keeps = { share: 0.25, ...flag };
  return (copy.state ? "yes" : "no") + (copy.share == null ? "-" : copy.share + 1) + (keeps.share == null ? "-" : keeps.share + 1) + typeof keeps.state;
}
for (let turn = 0; turn < 3; turn++) console.log(look(turn));`,
};

for (const [name, text] of Object.entries(programs)) {
  test(`a spread of an instance lays undefined or null under a name that the literal writes: ${name}`, async () => {
    using dir = tempDir("aot-spread-of-an-instance", { [name]: text });
    const cwd = String(dir);
    const plain = await run([bunExe(), name], cwd, bunEnv);
    expect(plain.exitCode).toBe(0);
    const executable = join(cwd, "program");
    expect(
      (await run([bunExe(), "build", "--compile", "--aot", name, "--outfile", executable], cwd, bunEnv)).exitCode,
    ).toBe(0);
    const compiled = await run([executable], cwd, bunEnv);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  }, 120_000);
}
