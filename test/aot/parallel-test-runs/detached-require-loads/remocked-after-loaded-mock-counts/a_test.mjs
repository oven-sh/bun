import { expect, test, vi } from "bun:test";
const turns = async count => {
  for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done));
};
test("a load that gave up calls the newest factory in a later job", async () => {
  vi.doMock("./api.mjs", async () => {
    await new Promise(() => {});
  });
  expect(() => require("./page.mjs")).toThrow();
  vi.doMock("./api.mjs", () => ({ list: ["cart"] }));
  console.log(require("./api.mjs").list.join());
  vi.doMock("./api.mjs", async () => {
    console.log("the newest factory is called");
    return { list: ["newest"] };
  });
  console.log("mocked again");
  await turns(3);
  console.log("turns are over");
  console.log((await import("./menu.mjs")).title);
});
