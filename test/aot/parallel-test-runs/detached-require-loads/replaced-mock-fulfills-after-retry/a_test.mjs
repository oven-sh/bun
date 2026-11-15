import { test, vi } from "bun:test";
const turns = async count => {
  for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done));
};
let calls = 0;
const required = name => {
  try {
    return String(require(name).label);
  } catch (error) {
    return String(error.message).includes("async module") ? "refused" : "threw " + error.message;
  }
};
const throws = () =>
  vi.doMock("./reed.mjs", () => {
    throw new RangeError("call " + ++calls);
  });
let openPond;
test("pond is left", () => {
  vi.doMock("./reed.mjs", async () => {
    await new Promise(done => (openPond = done));
    return { thread: "replaced mock" };
  });
  console.log(required("./pond.mjs"));
});
test("a later mock throws at once", async () => {
  throws();
  console.log(required("./weir.mjs"));
  await turns(4);
  console.log("calls", calls);
});
test("the replaced factory fulfills", async () => {
  openPond();
  await turns(4);
  console.log(required("./weir.mjs"), "| calls", calls);
  console.log(required("./bank.mjs"), "| calls", calls);
});
