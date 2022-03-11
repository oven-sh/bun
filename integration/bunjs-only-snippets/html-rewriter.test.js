import { describe, it, expect } from "bun:test";

describe("HTMLRewriter", () => {
  it("exists globally", () => {
    expect(typeof HTMLRewriter).toBe("function");
    console.log(HTMLRewriter.name);
  });
});
