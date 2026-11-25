import { test, vi } from "bun:test";
const turns = async count => {
  for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done));
};
const required = name => {
  try {
    return String(require(name).label);
  } catch {
    return "refused";
  }
};
let open;
const gate = new Promise(done => (open = done));
const left = () =>
  vi.doMock("./spool.mjs", async () => {
    await gate;
    return { thread: "first" };
  });
test("both left loads finish first, in their order", async () => {
  left();
  console.log(required("./loom.mjs"));
  console.log(required("./shed.mjs"));
  vi.doMock("./spool.mjs", () => ({ thread: "later" }));
  vi.doMock("./dye.mjs", () => ({ color: "mock" }));
  console.log(required("./vat.mjs"));
  open();
  await turns(4);
  console.log("settled");
});
