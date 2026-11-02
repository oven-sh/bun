// Runs alone: it judges by the memory that a build holds.
import { isASAN, isDebug, isWindows } from "harness";
import { expectPeakBytesForEachItem } from "./long-functions-instructions";
import {
  writeFieldsStoredInTry,
  writeFieldsStoredInTryOfHotFunction,
  writeStringsStoredInTry,
} from "./long-functions-programs";
import { test } from "./supported";

const isSlowBuild = isDebug || isASAN;

test.concurrent.skipIf(isSlowBuild || isWindows)(
  "a build keeps a bounded number of bytes for each field a try block stores to a local",
  async () => {
    await expectPeakBytesForEachItem(12_000, writeFieldsStoredInTry, 50_000);
  },
  240_000,
);

// Each local is live along the likely path and dead in the rare blocks between its blocks.
test.concurrent.skipIf(isSlowBuild || isWindows)(
  "a build keeps a bounded number of bytes for each field a try block in a hot function stores to a local",
  async () => {
    await expectPeakBytesForEachItem(16_000, writeFieldsStoredInTryOfHotFunction, 40_000);
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
