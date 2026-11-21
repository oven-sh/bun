// In a hardened build, Rust's arithmetic and the standard library check more than elsewhere, and end the process if they find
// something. No other test of src/icu runs on such a build.
import { expect, test } from "bun:test";
import { differencesFrom, inParts, loadCases } from "../js/web/intl/intl-golden/observe";
import "./hardened";
import { without } from "./harness/capabilities";

test.skipIf(!!without("a hardened build")).each(inParts(await loadCases(), "", 1000))("%s", (_, some) => {
  expect(differencesFrom(some)).toBe("");
});
