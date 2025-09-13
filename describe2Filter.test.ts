import { test, describe, beforeEach, afterAll, afterEach, beforeAll } from "bun:test";

describe("ABC", () => {
  beforeAll(() => console.log("beforeAll(ABC) called"));
  beforeEach(() => console.log("beforeEach(ABC) called"));
  afterAll(() => console.log("afterAll(ABC) called"));
  afterEach(() => console.log("afterEach(ABC) called"));

  console.log("describe(ABC) called");
  test("DEF", () => {
    console.log("DEF");
  });
});
describe("GHI", () => {
  beforeAll(() => console.log("beforeAll(GHI) called"));
  beforeEach(() => console.log("beforeEach(GHI) called"));
  afterAll(() => console.log("afterAll(GHI) called"));
  afterEach(() => console.log("afterEach(GHI) called"));

  console.log("describe(GHI) called");
  test("JKL", () => {
    console.log("JKL");
  });
});
