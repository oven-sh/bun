import { mock, test } from "bun:test";
mock.module("./leaf.mjs", () => ({ leaf: "patch" }));
test("a", () => {});
