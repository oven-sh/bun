import { test, vi } from "bun:test";
const turns = async count => {
  for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done));
};
const required = name => {
  try {
    return String(require(name).label);
  } catch (error) {
    return error instanceof RangeError ? "threw call " + error.call : "refused";
  }
};
let calls = 0;
const reported = new Set();
// Whoever reports such an error reads its message.
class CountedError extends RangeError {
  call = ++calls;
  get message() {
    reported.add(this.call);
    return "call " + this.call;
  }
}
const never = () =>
  vi.doMock("./reed.mjs", async () => {
    await new Promise(() => {});
  });
test("the calls of the loads after the first are reported", async () => {
  never();
  console.log(required("./pond.mjs"));
  never();
  console.log(required("./bank.mjs"));
  vi.doMock("./reed.mjs", () => {
    throw new CountedError();
  });
  console.log(required("./weir.mjs"));
  await turns(4);
});
test("what was reported", () => {
  console.log("calls", calls, "| reported:", [...reported].sort().join());
});
