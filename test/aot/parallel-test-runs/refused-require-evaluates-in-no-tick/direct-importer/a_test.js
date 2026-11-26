import { vi, test } from "bun:test";
globalThis.bodies = [];
const short = e => "threw " + String(e.message).replace(/\/\S*\//g, "").slice(0, 40);
const now = read => { try { return String(read()); } catch (e) { return short(e); } };
const count = async () => { let ticks = 0; const seen = []; let had = 0; while (ticks < 60) { if (globalThis.bodies.length > had) { seen.push(globalThis.bodies.slice(had).join("+") + "@" + ticks); had = globalThis.bodies.length; } await 0; ticks++; } return seen.join(" ") || "never"; };
test("t", async () => {
  vi.doMock("./inner.js", async () => { await 0; return { value: "inner mock" }; });
  console.log("| require:", now(() => import.meta.require("./dep.js").value));
  console.log("| bodies:", await count());
});
