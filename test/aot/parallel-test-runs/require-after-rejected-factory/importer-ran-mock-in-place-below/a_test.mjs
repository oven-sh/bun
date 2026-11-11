import { test, vi } from "bun:test";
const short = error => "threw " + String(error.message).replace(/\/\S*\//g, "").slice(0, 30);
const required = () => {
  try {
    return String(import.meta.require("./pump.mjs").read());
  } catch (error) {
    return short(error);
  }
};
const turns = async count => {
  for (let turn = 0; turn < count; turn++) await 0;
};
test("so does an importer above another module", async () => {
  vi.doMock("./valve.mjs", () => ({ state: "earlier mock" }));
  console.log("earlier:", required());
  vi.doMock("./valve.mjs", async () => {
    await 0;
    return { state: "later mock" };
  });
  console.log("first:", required());
  await turns(2);
  console.log("second:", required());
  await turns(40);
  console.log("third:", required());
});
