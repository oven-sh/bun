import { beforeAll, mock, test } from "bun:test";
beforeAll(() => {
  mock.module("kiln", () => ({ default: { fire: () => "patch" }, fire: () => "patch" }));
});
test("b", () => {});
