// `map` bears its result with the length of its source. A result of numbers is kept as the engine keeps a list of numbers, whatever its length:
// a loop over it then reads numbers, not boxed values. Plain Bun is no measure here: how it keeps such a list differs from run to run.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const program = `
const { jscDescribe } = require("bun:jsc");
const kept = list => /ArrayWith([A-Za-z0-9]+)/.exec(jscDescribe(list))[1];
const parsed = (length, element) => JSON.parse("[" + Array.from({ length }, (_, i) => element(i)).join() + "]");
const name = JSON.parse('"go"');
function say(label, source, maker) {
  const seen = new Set();
  for (let turn = 0; turn < 60; turn++) seen.add(kept(maker[name](source)));
  console.log(label + ": " + [...seen].join("+"));
}
for (const length of [40, 128, 300, 5000]) {
  say(length + " whole numbers", parsed(length, i => i), { go(s) { return s.map(x => x); } });
  say(length + " fractions", parsed(length, i => i + 0.5), { go(s) { return s.map(x => x); } });
  say(length + " whole numbers halved", parsed(length, i => i), { go(s) { return s.map(x => x / 2 + 0.25); } });
  say(length + " objects to a fraction of each", parsed(length, i => '{"x":' + (i + 0.5) + "}"), { go(s) { return s.map(row => row.x); } });
  say(length + " fractions to texts", parsed(length, i => i + 0.5), { go(s) { return s.map(x => "t" + x); } });
}
`;

test("a list of numbers that map makes is kept as numbers at every length", async () => {
  using directory = tempDir("aot-mapped-numbers", { "mapped.cjs": program });
  const folder = String(directory);
  const executable = join(folder, "mapped");
  const build = await run([bunExe(), "build", "--compile", "--aot", "mapped.cjs", "--outfile", executable], folder);
  expect(build).toMatchObject({ exitCode: 0 });
  const { stdout, exitCode } = await run([executable], folder);
  expect(exitCode).toBe(0);
  expect(stdout.trim().split("\n")).toEqual(
    [40, 128, 300, 5000].flatMap(length => [
      `${length} whole numbers: Int32`,
      `${length} fractions: Double`,
      `${length} whole numbers halved: Double`,
      `${length} objects to a fraction of each: Double`,
      `${length} fractions to texts: Contiguous`,
    ]),
  );
});
