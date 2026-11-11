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

test("a file is loaded while a factory waits, and again behind it", async () => {
  vi.doMock("./wick.mjs", () => (settled = factory()));
  console.log("SAID gave up " + asked(() => require("./lamp.mjs")));
  console.log("SAID while it waits " + (await import("./torch.mjs")).seen);
  open();
  await settled;
  await nextTurn();
  console.log("SAID behind it " + (await import("./torch.mjs")).seen);
  console.log("SAID calls " + calls);
});
