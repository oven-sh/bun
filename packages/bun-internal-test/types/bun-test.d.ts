import type { afterAll, afterEach, beforeAll, beforeEach, describe, Expect, test } from "bun:test";

export type BunExpect = (value: unknown) => Expect;
export type BunDescribe = typeof describe;
export type BunTest = typeof test;
export type BunHook = typeof beforeAll | typeof beforeEach | typeof afterAll | typeof afterEach;

export type TestContext = {
  expect: BunExpect;
  describe: BunDescribe;
  test: BunTest;
  beforeAll: BunHook;
  beforeEach: BunHook;
  afterAll: BunHook;
  afterEach: BunHook;
};

declare module "bun" {
  function jest(path: string): TestContext;
}
