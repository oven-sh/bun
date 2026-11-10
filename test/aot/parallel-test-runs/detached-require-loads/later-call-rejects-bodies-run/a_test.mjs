import { test, vi } from "bun:test";
const turns = async count => {
  for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done));
};
const required = name => {
  try {
    return String(require(name).label);
  } catch {
    return "threw";
  }
};
let open;
const never = new Promise(() => {});
const gate = new Promise(done => (open = done));
test("a call that came to a fetch in flight rejects, and the load goes on", async () => {
  vi.doMock("./spool.mjs", async () => {
    await never;
  });
  console.log(required("./shuttle.mjs"));
  vi.doMock("./spool.mjs", async () => {
    await gate;
    throw new RangeError("the second call rejects");
  });
  console.log(required("./loom.mjs"));
  vi.doMock("./spool.mjs", () => ({ thread: "third mock" }));
  open();
  await turns(5);
  console.log("the end");
});
