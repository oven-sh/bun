import { vi, mock, test } from "bun:test";
globalThis.bodies ??= 0;
let calls = 0, innerCalls = 0;
const short = e => "threw " + String(e.message).replace(/\/\S*\//g, "").slice(0, 48);
const now = read => { try { return String(read()); } catch (e) { return short(e); } };
const tried = async read => { try { return String(await read()); } catch (e) { return short(e); } };
const say = (...words) => console.log("|", ...words, "| calls", calls, "inner", innerCalls, "bodies", globalThis.bodies);
const untilBodyRuns = async () => { for (let turn = 0; turn < 1000 && !globalThis.bodies; turn++) await new Promise(setImmediate); };
test("next", async () => {
  say("next import:", await tried(async () => (await import("./dep.js")).flag));
  say("next inner:", await tried(async () => (await import("./inner.js")).inner));
});
