import { vi, test } from "bun:test";
globalThis.bodies ??= 0;
let calls = 0, innerCalls = 0;
const short = e => "threw " + String(e.message).replace(/\/\S*\//g, "").slice(0, 48);
const now = read => { try { return String(read()); } catch (e) { return short(e); } };
const tried = async read => { try { return String(await read()); } catch (e) { return short(e); } };
const say = (...words) => console.log("|", ...words, "| calls", calls, "inner", innerCalls, "bodies", globalThis.bodies);
test("first", async () => {
  vi.doMock("./inner.js", async () => { innerCalls++; await 0; throw new Error("inner tardy " + innerCalls); });
  vi.doMock("./dep.js", async original => { calls++; return { ...(await original()), flag: "mock" }; });
  say("require:", now(() => import.meta.require("./dep.js").flag));
  await 0; await 0; await 0; await 0; await 0; await 0; say("ticks");
  say("require:", now(() => import.meta.require("./dep.js").flag));
});
