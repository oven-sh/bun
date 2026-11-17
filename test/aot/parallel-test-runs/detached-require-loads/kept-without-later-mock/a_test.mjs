import { test, vi } from "bun:test";
const turns = async count => {
  for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done));
};
const short = error => "threw " + String(error.message).replace(/\/\S*\//g, "").slice(0, 30);
const required = name => {
  try {
    return String(require(name).label);
  } catch (error) {
    return short(error);
  }
};
let open;
const gate = new Promise(done => (open = done));
const views = () => (globalThis.views ?? []).map(view => view()).join(" / ");
test("without a later mock the next load gets the evaluated module", async () => {
  vi.doMock("./spool.mjs", async () => {
    await gate;
    return { thread: "only" };
  });
  console.log("left:", required("./loom.mjs"));
  open();
  await turns(4);
  console.log("settled:", views());
  console.log(required("./loom.mjs"), "| views:", views());
});
