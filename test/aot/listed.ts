// `test`, `describe` and the hooks of bun:test, as they are. Where CI leaves the file out (harness/every-build.ts) they declare nothing.
import {
  afterAll as afterAllOfBun,
  afterEach as afterEachOfBun,
  beforeAll as beforeAllOfBun,
  beforeEach as beforeEachOfBun,
  describe as describeOfBun,
  test as testOfBun,
} from "bun:test";
import { unlessLeftOut } from "./harness/left-out";

export const test = unlessLeftOut(testOfBun);
export const it = test;
export const describe = unlessLeftOut(describeOfBun);
export const beforeAll = unlessLeftOut(beforeAllOfBun);
export const afterAll = unlessLeftOut(afterAllOfBun);
export const beforeEach = unlessLeftOut(beforeEachOfBun);
export const afterEach = unlessLeftOut(afterEachOfBun);
