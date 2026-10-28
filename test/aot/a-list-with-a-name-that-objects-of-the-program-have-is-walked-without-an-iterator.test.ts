import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileCommand, runtimeEnvironment } from "./harness/flags";
import { built, slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const rounds = 20_000;

// `sumFlags` walks what it is given and then stores under `flags`, a name that the objects of two classes have and that `mark` stores under too. Nobody tells the compiler what arrives: the lists come out of
// JSON.parse. Neither class can be walked, so the name says nothing about the loop, which tests for an array like any other loop over an unknown value. `Range` can be walked:
// a loop over what is expected to be one calls its method.
const source = `
class Leaf { constructor(flags) { this.flags = flags; this.text = "leaf"; } }
class Branch { constructor(flags, left, right) { this.flags = flags; this.left = left; this.right = right; } }
class Range {
  constructor(length) { this.length = length; this.steps = 0; }
  *[Symbol.iterator]() { for (let i = 0; i < this.length; i++) yield new Leaf(i); }
}
function mark(node, flags) { node.flags |= flags; return node; }
function sumFlags(children) {
  let flags = 0;
  for (const child of children) flags |= child.flags;
  children.flags = flags;
  return flags;
}
function countSteps(range) {
  let steps = 0;
  for (const leaf of range) steps += leaf.flags;
  range.steps = steps;
  return steps;
}
const texts = ['[{"flags":1},{"flags":2},{"flags":4}]', '[{"flags":8}]', "[]"];
const tree = mark(new Branch(3, mark(new Leaf(1), texts.length << 4), new Leaf(2)), texts.length << 8);
let total = tree.flags + tree.left.flags + tree.right.flags;
const lists = texts.map(text => JSON.parse(text));
for (let i = 0; i < ${rounds}; i++) total += sumFlags(lists[i % lists.length]);
total += countSteps(new Range(4));
console.log(total, lists.map(list => list.flags).join());
`;

// A place shows up in the counts with the first free list that it uses up: some hundred cells. The loop would make an iterator a call and a result a step.
async function cellsOfIteration(flags: string[]) {
  using dir = tempDir("aot-list-with-a-name-of-objects", { "main.js": source });
  const folder = String(dir);
  const executable = join(folder, isWindows ? "app.exe" : "app");
  const counts = join(folder, "counts.txt");
  built(await spawned([bunExe(), ...compileCommand, ...flags, "main.js", "--outfile", executable], folder, env));
  const plain = await spawned([bunExe(), "main.js"], folder, env);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: "100833 7,8,0\n", exitCode: 0 });
  const ran = await spawned([executable], folder, { ...env, [runtimeEnvironment.countsPath]: counts });
  expect(ran).toEqual({ stdout: plain.stdout, stderr: "", exitCode: 0, signal: null });
  return readFileSync(counts, "utf8")
    .split("\n")
    .filter(line => /^(allocation|refill) .*(\{_value,_done_\}|ArrayIterator)/.test(line));
}

describe.concurrent("a list with a name that objects of the program have is walked without an iterator", () => {
  test.each([
    ["at the usual heat", []],
    ["where all code counts as hot", ["--aot-heat=everything-is-hot"]],
    ["where every call stays a call", ["--aot-disable=InlineCalls"]],
  ])("%s", (_, flags) => slot(async () => expect(await cellsOfIteration(flags)).toEqual([])), 300_000);
});
