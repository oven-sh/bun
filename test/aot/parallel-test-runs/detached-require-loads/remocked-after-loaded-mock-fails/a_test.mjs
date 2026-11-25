import { expect, test, vi } from "bun:test";
const turns = async count => {
  for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done));
};
const waits = name => async () => {
  await turns(20);
  return { list: [name] };
};
test("the page gives up", () => {
  vi.doMock("./api.mjs", waits("a"));
  expect(() => require("./page.mjs")).toThrow();
});
test("the menu gives up", () => {
  vi.doMock("./api.mjs", waits("a"));
  expect(() => require("./menu.mjs")).toThrow();
});
test("the loads that gave up call the newest factory, and its error fails this test", async () => {
  vi.doMock("./api.mjs", () => ({ list: ["cart"] }));
  console.log(require("./cart.mjs").title);
  vi.doMock("./api.mjs", async () => {
    throw new Error("down");
  });
  await turns(40);
});
