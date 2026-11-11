import { test, vi } from "bun:test";
const rest = time => new Promise(done => setTimeout(done, time));
const say = (name, get) => { try { console.log("SAID " + name + " " + get()); } catch (error) { console.log("SAID " + name + " " + error.name); } };
test("b", async () => {
  vi.doMock("./lib.mjs", () => ({ value: "other", read: () => "other" }));
  let actual = {};
  try { actual = await vi.importActual("./lib.mjs"); console.log("SAID came"); } catch (error) { console.log("SAID rejected " + error.name + " " + error.message); }
  say("value", () => actual.value);
  say("read", () => actual.read());
  await rest(80);
  say("later value", () => actual.value);
  say("later read", () => actual.read());
}, 8000);
