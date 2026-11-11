import { test, vi } from "bun:test";
let open;
globalThis.gate = new Promise(resolve => { open = resolve; });
let calls = 0;
const turn = () => new Promise(resolve => setImmediate(resolve));
const files = { first: () => require("./first.mjs"), outer: () => require("./outer.mjs"), side: () => require("./side.mjs") };
const asked = file => {
  try {
    return String(files[file]().seen);
  } catch (error) {
    return error.name;
  }
};
const say = (word, file) => console.log("SAID " + word + " " + asked(file) + " | ran " + (globalThis.ran ?? "none"));
test("the files between", async () => {
  vi.doMock("./wick.mjs", async () => {
    calls++;
    await globalThis.gate;
    return { width: "mock " + calls };
  });
  say("first", "first");
  say("second", "outer");
  open();
  await turn();
  await turn();
  say("third", "side");
  say("fourth", "outer");
  console.log("SAID calls " + calls);
}, 4000);
