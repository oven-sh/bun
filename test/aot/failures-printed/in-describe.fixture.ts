import { expect } from "bun:test";
import { describe, it } from "../harness/declare";

describe("a body that throws", () => {
  it("before the throw", () => {
    expect(1).toBe(1);
  });
  throw new Error("thrown in the body of describe");
});

describe("another", () => {
  it("still runs", () => {
    expect(2).toBe(2);
  });
});
