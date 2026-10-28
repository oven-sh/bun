// Runs alone: it judges by the memory that a build holds.
import { isASAN, isDebug, isWindows } from "harness";
import { expectPeakBytesForEachItem } from "./long-functions-instructions";
import { writeFieldsStoredInTry, writeStringsStoredInTry } from "./long-functions-programs";
import { test } from "./supported";

const isSlowBuild = isDebug || isASAN;

test.concurrent.skipIf(isSlowBuild || isWindows)(
  "a build keeps a bounded number of bytes for each field a try block stores to a local",
  async () => {
    await expectPeakBytesForEachItem(12_000, writeFieldsStoredInTry, 50_000);
  },
  240_000,
);

test.concurrent.skipIf(isSlowBuild || isWindows)(
  "a build keeps a bounded number of bytes for each string a try block stores to a local",
  async () => {
    await expectPeakBytesForEachItem(12_000, writeStringsStoredInTry, 47_000);
  },
  240_000,
);
