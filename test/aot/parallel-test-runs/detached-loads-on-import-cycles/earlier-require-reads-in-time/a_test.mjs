import { test, vi } from "bun:test";
globalThis.bodies = [];
let open;
const gate = new Promise(done => (open = done));
const settle = async () => {
  open();
  for (let turn = 0; turn < 3; turn++) await new Promise(done => setImmediate(done));
};
const short = error => "threw " + String(error.message).replace(/\/\S*\//g, "").slice(0, 34);
const required = name => {
  try {
    return String(require(name).label);
  } catch (error) {
    return short(error);
  }
};
const say = (...words) => console.log(...words, "| bodies:", globalThis.bodies.join());
test("the order of the two requires decides whether a binding is read in time", async () => {
  vi.doMock("./reed.mjs", async () => {
    await gate;
    return { label: "mocked reed" };
  });
  say(required("./pond.mjs"), "|", required("./heron.mjs"));
  await settle();
  say("settled");
  say(required("./heron.mjs"), "|", required("./pond.mjs"));
});
