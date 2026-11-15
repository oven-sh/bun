// D.map(callback) on a D that nobody knows (out of JSON.parse): lists alone have `map` among the classes whose methods are found by name, so Link's held reading sees a list of
// what the callback gives; the guess is tested at the run. The proving reading says nothing, and under a name that texts have too (slice) the held reading says nothing either.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runTestaot } from "./engine/testaot";
import { without } from "./harness/capabilities";
import { run } from "./harness/run";
import { test } from "./supported";

const program = (made: string) => `"use strict";
const D = JSON.parse(process.argv[2] || "[[1,2,3],[4,5,6]]");
const V = ${made};
function sum(V) { let s = 0; for (let i = 0; i < V.length; i++) { const row = V[i]; for (let j = 0; j < row.length; j++) s += row[j]; } return s; }
console.log(sum(V));
`;
const files = {
  "mapped.js": program("D.map(r => Float64Array.from(r))"),
  "sliced.js": program("D.slice(0)"),
};

async function readsSeenToGiveViews(cwd: string, name: string, reading: string[]) {
  const [executable, wire] = [join(cwd, `${name}.exe`), join(cwd, `${name}.wire`)];
  const build = [bunExe(), "build", "--compile", "--aot", `--aot-out=${wire}`, `${name}.js`, "--outfile", executable];
  expect((await run(build, cwd, bunEnv)).exitCode).toBe(0);
  expect((await run([executable], cwd, bunEnv)).stdout.trim()).toBe("21");
  const printed = (await runTestaot("print", wire)).lines;
  const sum = printed.map(line => /^function (f\d+) name="sum"/.exec(line)).find(found => found)![1];
  const linked = (await runTestaot("link", wire, ...reading)).lines;
  return linked.filter(line => line.startsWith(`read ${sum} `) && /\bFloat64Array\b/.test(line)).length;
}

test.skipIf(!!without("testaot"))(
  "a list made by map off what nobody knows is seen to hold what the callback gives",
  async () => {
    using dir = tempDir("aot-list-made-by-map", files);
    const cwd = String(dir);
    expect({
      held: await readsSeenToGiveViews(cwd, "mapped", ["held"]),
      proving: await readsSeenToGiveViews(cwd, "mapped", []),
      sliced: await readsSeenToGiveViews(cwd, "sliced", ["held"]),
    }).toEqual({ held: 1, proving: 0, sliced: 0 });
  },
  600_000,
);
