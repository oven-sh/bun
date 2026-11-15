import { mock, test, vi } from "bun:test";
let pours = 0;
const pour = () => {
  if (++pours === 1) throw new RangeError("the jug slips");
  return { drink: "mock" };
};
const serve = () => import("./table.mjs").then(table => table.served, error => error.message);
test("b", async () => {
  vi.doMock("flour", () => ({ grain: "of this test file" }));
  const pending = import("flour");
  vi.doUnmock("flour");
  console.log("SAID grain", (await pending).grain);
  vi.doMock("./jug.mjs", pour);
  console.log("SAID first", await serve(), pours);
  mock.module("flour", () => ({ grain: "mock" }));
  console.log("SAID second", await serve(), pours);
});
