// @jsxImportSource ./tiny
// @jsxRuntime react-jsx
import { expect, test } from "bun:test";
import { other } from "./other";

test("each file calls what its pragma names", () => {
  const element = <a />;
  console.log(element, other);
  expect(typeof element).toBe("string");
});
