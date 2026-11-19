import { test, vi } from "bun:test";
globalThis.bodies = [];
const timer = Promise.withResolvers();
globalThis.timerFires = timer.resolve;
let open;
const gate = new Promise(done => (open = done));
const settle = async () => {
  open();
  for (let turn = 0; turn < 20; turn++) await new Promise(done => setImmediate(done));
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
test("a timer that the body sets fails the test", async () => {
  vi.doMock("./reed.mjs", async () => {
    await gate;
    return { label: "mocked reed" };
  });
  say(required("./pond.mjs"));
  await settle();
  await timer.promise;
  await settle();
  say("the test went on");
});
