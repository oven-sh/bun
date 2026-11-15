import { test, vi } from "bun:test";
let calls = 0;
globalThis.bodies = 0;
const short = error => "threw " + String(error.message).replace(/\/\S*\//g, "").slice(0, 30);
const required = () => {
  try {
    return String(import.meta.require("./pump.mjs").read());
  } catch (error) {
    return short(error);
  }
};
const turns = async count => {
  for (let turn = 0; turn < count; turn++) await 0;
};
const say = (...words) => console.log(...words, "| calls", calls, "bodies", globalThis.bodies);
test("a require after the load has failed gets its error", async () => {
  vi.doMock("./valve.mjs", async () => {
    calls++;
    await 0;
    throw new Error("rejected " + calls);
  });
  say("first:", required());
  await turns(4);
  say("second:", required());
  await turns(40);
  say("third:", required());
});
