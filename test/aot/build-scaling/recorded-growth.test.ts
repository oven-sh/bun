import { expect } from "bun:test";
import { test } from "../harness/declare";
import { lowerRecordedGrowth } from "./recorded-growth";

test("a run under the default bound keeps a recorded growth", () => {
  expect(lowerRecordedGrowth({ peakBytes: 2.66 }, {})).toEqual({ peakBytes: 2.66 });
  expect(lowerRecordedGrowth({ instructions: 3.2, peakBytes: 2.66, counts: { Steps: 4 } }, {})).toEqual({
    instructions: 3.2,
    peakBytes: 2.66,
    counts: { Steps: 4 },
  });
});

test("a measurement over the default bound lowers a recorded growth and never raises it", () => {
  expect(lowerRecordedGrowth({ instructions: 3.2, peakBytes: 2.66 }, { instructions: 2.8 })).toEqual({
    instructions: 2.8,
    peakBytes: 2.66,
  });
  expect(lowerRecordedGrowth({ peakBytes: 2.66 }, { peakBytes: 3.1 })).toEqual({ peakBytes: 2.66 });
});

test("each count is kept or lowered by itself", () => {
  expect(lowerRecordedGrowth({ counts: { Steps: 4, Reads: 3.5 } }, { counts: { Steps: 3 } })).toEqual({
    counts: { Steps: 3, Reads: 3.5 },
  });
});

test("a shape with no growth recorded or measured has none", () => {
  expect(lowerRecordedGrowth(undefined, {})).toBeUndefined();
  expect(lowerRecordedGrowth({}, {})).toBeUndefined();
});
