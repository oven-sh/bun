import {
  test,
  expect,
  describe,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  spyOn,
} from "bun:test";
import { expectType } from "tsd";

const spy = spyOn(console, "log");
expectType<any[][]>(spy.mock.calls);

const hooks = [beforeAll, beforeEach, afterAll, afterEach];

for (const hook of hooks) {
  hook(() => {
    // ...
  });
  hook(async () => {
    // ...
  });
  hook((done: (err?: unknown) => void) => {
    done();
    done(new Error());
    done("Error");
  });
}

describe("bun:test", () => {
  describe("expect()", () => {
    test("toThrow()", () => {
      function fail() {
        throw new Error("Bad");
      }
      expect(fail).toThrow();
      expect(fail).toThrow("Bad");
      expect(fail).toThrow(/bad/i);
      expect(fail).toThrow(Error);
      expect(fail).toThrow(new Error("Bad"));
    });
  });
  test("expect()", () => {
    expect(1).toBe(1);
    expect(1).not.toBe(2);
    expect({ a: 1 }).toEqual({ a: 1, b: undefined });
    expect({ a: 1 }).toStrictEqual({ a: 1 });
    expect(new Set()).toHaveProperty("size");
    expect(new Uint8Array()).toHaveProperty("byteLength", 0);
    expect([]).toHaveLength(0);
    expect(["bun"]).toContain("bun");
    expect(true).toBeTruthy();
    expect(false).toBeFalsy();
    expect(Math.PI).toBeGreaterThan(3.14);
    expect(Math.PI).toBeGreaterThan(3n);
    expect(Math.PI).toBeGreaterThanOrEqual(3.14);
    expect(Math.PI).toBeGreaterThanOrEqual(3n);
    expect(NaN).toBeNaN();
    expect(null).toBeNull();
    expect(undefined).toBeUndefined();
    expect(undefined).not.toBeDefined();
  });
});

// inference should work when data is passed directly in
describe.each([
  ["a", true, 5],
  ["b", false, "asdf"],
])("test.each", (a, b, c) => {
  expectType<string>(a);
  expectType<boolean>(b);
  expectType<number | string>(c);
});
test.each([
  ["a", true, 5],
  ["b", false, "asdf"],
])("test.each", (a, b, c) => {
  expectType<string>(a);
  expectType<boolean>(b);
  expectType<number | string>(c);
});

const data = [
  ["a", true, 5],
  ["b", false, "asdf"],
];

// inference won't work when data can't be inferred
describe.each(data)("test.each", (a, b, c) => {
  expectType<string | number | boolean>(a);
  expectType<string | number | boolean>(b);
  expectType<string | number | boolean>(c);
});

// inference won't work when data can't be inferred
test.each(data)("test.each", data => {
  expectType<(string | number | boolean)[]>(data);
});
