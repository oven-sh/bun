import { expect } from "bun:test";
import { describe, it, test } from "../harness/declare";

describe("snapshots", () => {
  it("a stored object differs", () => {
    expect({ name: "ada", list: [1, 2, 3] }).toMatchSnapshot();
  });
  it("a stored text differs", () => {
    expect("first\nsecond\nthird").toMatchSnapshot();
  });
  it("with a hint", () => {
    expect(12).toMatchSnapshot("the hint");
  });
  it("inline differs", () => {
    expect({ a: 1, b: "two" }).toMatchInlineSnapshot(`
      {
        "a": 1,
        "b": "three",
      }
    `);
  });
  it("inline text differs", () => {
    expect("now").toMatchInlineSnapshot(`"then"`);
  });
  it("error snapshot differs", () => {
    expect(() => {
      throw new Error("the real message");
    }).toThrowErrorMatchingInlineSnapshot(`"another message"`);
  });
  it("matches", () => {
    expect([1, 2]).toMatchSnapshot();
  });
});

test("passes", () => {});
