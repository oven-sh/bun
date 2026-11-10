import { test, vi } from "bun:test";
const ticks = async (count) => { for (let k = 0; k < count; k++) await new Promise((resolve) => setImmediate(resolve)); };
const describe = (load) => { try { return String(load().seen); } catch (e) { return "threw " + String(e.message).split("/").pop().slice(0, 60); } };
let wick = 0, side = 0, openSide, openWick;
const never = new Promise(() => {});
const sideGate = new Promise((resolve) => { openSide = resolve; });
const wickGate = new Promise((resolve) => { openWick = resolve; });
test("other file imported first", async () => {
  vi.doMock("./wick.mjs", async () => { wick++; await never; return { width: "never" }; });
  vi.doMock("./side.mjs", async () => { side++; await sideGate; return { depth: "works" }; });
  console.log("first require: " + describe(() => require("./duo.mjs")));
  console.log("second require: " + describe(() => require("./duo.mjs")));
  vi.doMock("./wick.mjs", () => { wick++; throw new Error("wick " + wick); });
  openSide();
  await ticks(5);
  console.log("factory calls: wick " + wick + " side " + side);
  console.log("end");
}, 8000);
