import { jest, mock, test, vi } from "bun:test";
const require = import.meta.require;
const say = (...words) => console.log("SAID", ...words);
const get = load => load.then(m => Object.keys(m).join() + " " + m.value, error => error.message.slice(0, 20));
const error = load => load.then(() => null, error => error);
const tried = deed => { try { const m = deed(); return Object.keys(m).join() + " " + m.value; } catch (error) { return error.message.slice(0, 20); } };
test("b", async () => {
  const before = await error(import("./ledger.mjs"));
  await mock.module("./T.mjs", async () => { await 0; say("factory"); return { value: "mock" }; });
  say("the same refusal", before === await error(import("./ledger.mjs")));
  say("mocked", await get(import("./T.mjs")));
  say("required", tried(() => require("./T.mjs")));
  say("root", await get(import("./top.mjs")));
  say("the same refusal", before === await error(import("./ledger.mjs")));
});
