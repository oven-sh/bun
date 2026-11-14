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
const leave = async () => {
  vi.doMock("./spool.mjs", async () => {
    await gate;
    return { thread: "first" };
  });
  console.log("left:", required("./loom.mjs"));
  vi.doMock("./spool.mjs", () => ({ thread: "later" }));
  open();
  await turns(4);
  console.log("settled:", views());
};
test("the next load evaluates the importer again, and the first instance stays", async () => {
  await leave();
  const again = await import("./loom.mjs");
  console.log("again:", again.label, "| same", again === (await import("./loom.mjs")), "| keys", Object.keys(again).join());
  again.bump();
  console.log("views:", views());
});
