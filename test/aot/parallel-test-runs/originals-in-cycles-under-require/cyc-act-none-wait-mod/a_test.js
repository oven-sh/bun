import { mock, test, vi } from "bun:test";
const show = it => typeof it?.read === "function" ? "read " + it.read() : Object.keys(it).join();
const get = async f => { try { return show(await f()); } catch (e) { return "threw " + e.name + " " + e.message.slice(0, 22); } };
const say = (a, b) => console.log("SAID", a, b);
test("t", async () => {
  mock.module("./zero.js", async () => ({ ...(await vi.importActual("./zero.js")), e: 2 }));
  let r; try { r = show(require("./one.js")); } catch (e) { r = "threw " + e.name + " " + e.message.slice(0, 22); }
  say("first", r);
  await new Promise(r => setTimeout(r, 5)); say("again", await get(() => require("./one.js")));
});
