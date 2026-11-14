import { jest, mock, test, vi } from "bun:test";
const require = import.meta.require;
const say = (...words) => console.log("SAID", ...words);
const get = load => load.then(m => Object.keys(m).join() + " " + (m.crack ?? m.ladder), error => error.message.slice(0, 20));
const error = load => load.then(() => null, error => error);
const tried = deed => { try { return Object.keys(deed()).join(); } catch (error) { return error.message.slice(0, 20); } };
test("b", async () => {
  const before = await error(import("./ledger.mjs"));
  
  vi.doMock("./ladder.mjs", () => { say("factory"); return { crack: "mock", ladder: "mock" }; });
  say("the same refusal", before === await error(import("./ledger.mjs")));
  say("crack", await get(import("./crack.mjs")));
  say("ladder", await get(import("./ladder.mjs")));
});
