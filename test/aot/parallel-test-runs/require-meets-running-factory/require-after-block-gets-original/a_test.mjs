import { test, vi } from "bun:test";

let calls = 0;
let open;
let settled;
const gate = new Promise(resolve => {
  open = resolve;
});
const factory = async () => {
  calls++;
  await gate;
  return { width: "mock " + calls };
};
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const asked = load => {
  try {
    const found = load();
    return String(found.seen ?? found.width);
  } catch (error) {
    return String(error.message).slice(0, 22);
  }
};

test("no load is in flight: the require that called the factory gave up", async () => {
  vi.doMock("./wick.mjs", () => (settled = factory()));
  console.log("SAID gave up " + asked(() => require("./lamp.mjs")));
  vi.resetModules();
  console.log("SAID while it waits " + asked(() => require("./wick.mjs")));
  open();
  await settled;
  await nextTurn();
  console.log("SAID behind it " + asked(() => require("./wick.mjs")));
  console.log("SAID calls " + calls);
});
