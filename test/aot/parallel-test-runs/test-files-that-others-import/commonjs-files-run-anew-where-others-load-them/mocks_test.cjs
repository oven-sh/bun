const { mock, test } = require("bun:test");

mock.module("./rate.cjs", () => ({ rate: () => "mocked" }));
const { rate } = require("./rate.cjs");
const key = String("runs");
const run = Number(Reflect.get(globalThis, key) ?? 0) + 1;
Reflect.set(globalThis, key, run);
let calls = 0;
exports.next = () => `run ${run}, call ${++calls}`;

test("mocks", () => {
  console.log("mocks", exports.next(), rate());
});
