// A compiled loop reads the length of a view and the address of its bytes once, in front of the loop, and stores into the bytes in every turn without
// asking again, wherever nothing in the turn runs other code or writes the storage of views. For a call of a built-in that is what its row of the
// table says. So a row that says neither, and whose function makes a buffer for a view, detaches one or cuts one, lets the loop write into memory
// that is no longer the view's.
//
// Every such overload is called here with small views that were made by a length: their bytes lie in memory of the collector and move when a buffer
// is first made. Behind the call each view must have no buffer and its length.
//
//   AOT_BUILTINS_FILTER=<r>  only the functions whose path matches the regular expression
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { availableParallelism } from "node:os";
import { beforeAll, test } from "../supported";
import type { ViewReport } from "./native-contract/check-views";
import { runWorkers, type Results } from "./native-contract/run-workers";
import { isQuietForViews } from "./native-contract/targets";

const filter = process.env.AOT_BUILTINS_FILTER ?? ".";
const quiet = aotBuiltinEntries().entries.flatMap(entry =>
  new RegExp(filter).test(entry.path) ? entry.overloads.filter(isQuietForViews).map(overload => overload.token) : [],
);
const maxWorkers = 2;

const run = async (options: { filter: string; toldQuiet?: string }) => {
  using folder = tempDir("aot-quiet-rows-and-views", {});
  return await runWorkers({
    executable: bunExe(),
    environment: bunEnv,
    folder: String(folder),
    workerCount: Math.min(availableParallelism(), maxWorkers),
    worker: "views-worker.ts",
    ...options,
  });
};
const called = (results: Results) =>
  [...results.reports.values()].filter((report): report is ViewReport => "changes" in report && "callCount" in report);
const changesIn = (results: Results) =>
  called(results).flatMap(({ name, changes }) => changes.map(change => `${name}: ${change}`));

function defineTests() {
  if (quiet.length === 0) return void test.skip("this build of Bun has no ahead-of-time compiler", () => {});

  let results: Results;
  beforeAll(async () => {
    results = await run({ filter });
  }, 30 * 60_000);

  test("every quiet overload has a report", () => {
    expect(quiet.filter(token => !results.reports.has(token) && !results.ended.includes(token))).toEqual([]);
  });

  test("no call ends its process or stays away", () => {
    expect(results.howEnded).toEqual([]);
  });

  // Most quiet overloads take no view anywhere. Of those that do, one that only ever throws has shown little.
  test("most of the overloads that take a view return from some call", () => {
    if (filter !== ".") return;
    const takingViews = called(results).filter(({ callCount }) => callCount > 0);
    expect(takingViews).not.toEqual([]);
    expect(takingViews.filter(({ returned }) => returned > 0).length).toBeGreaterThan(takingViews.length / 2);
  });

  test("behind a call of a quiet overload a view has no buffer and its length", () => {
    expect(changesIn(results)).toEqual([]);
  });

  // Each of these makes the buffer, and its row says so. Taken for quiet it has to be caught.
  test.each(["%TypedArray%.prototype.buffer", "structuredClone", "Bun.file"])(
    "the row of %s, taken for quiet, is caught",
    async path => {
      const pattern = `^${RegExp.escape(path)}$`;
      const lying = await run({ filter: pattern, toldQuiet: pattern });
      expect(lying.howEnded).toEqual([]);
      expect(changesIn(lying).filter(change => change.includes("a buffer was made for it"))).not.toEqual([]);
    },
    5 * 60_000,
  );
}

defineTests();
