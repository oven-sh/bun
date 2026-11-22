// In a hardened build, Rust's arithmetic and the standard library check more than elsewhere, and end the process if they find
// something. No other test of src/icu runs on such a build.
import { expect, test } from "bun:test";
import { canObserveIn, differencesFrom, inParts, loadCases, observeIn } from "../js/web/intl/intl-golden/observe";
import "./hardened";
import { without } from "./harness/capabilities";

const cases = await loadCases();
const withFiles = Object.entries(cases.environments).filter(([it]) => it.startsWith("FILES=") && canObserveIn(it));

test.skipIf(!!without("a hardened build")).each(inParts(cases, "", 1000))("%s", (_, some) => {
  expect(differencesFrom(some)).toBe("");
});

test.skipIf(!!without("a hardened build")).concurrent.each(withFiles)("%s", async (environment, some) => {
  const sources = some.map(([source]) => source);
  expect(differencesFrom(some, await observeIn(environment, sources))).toBe("");
});
