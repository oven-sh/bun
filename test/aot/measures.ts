// `test`, `describe` and `beforeAll` for a file whose cases all hold a cost against a bound: CPU time, a count, how something grows.
// A Bun with a sanitizer is several times slower, and not evenly, so the bound says nothing there; what such a file builds and runs,
// other files build and run too. The lane with the sanitizer has no minute to spare, so there every case of the file is skipped.
import { describe as describeOfBun, test as testOfBun } from "bun:test";
import { isASAN } from "harness";
import {
  alwaysSkipped,
  beforeAll as beforeAllSupported,
  describe as describeSupported,
  test as testSupported,
} from "./supported";

export const test: typeof testSupported = isASAN ? alwaysSkipped(testOfBun.skip) : testSupported;
export const describe: typeof describeSupported = isASAN ? alwaysSkipped(describeOfBun.skip) : describeSupported;
export const beforeAll: typeof beforeAllSupported = isASAN ? () => {} : beforeAllSupported;
