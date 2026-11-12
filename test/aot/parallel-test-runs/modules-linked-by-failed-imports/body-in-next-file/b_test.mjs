import { test, vi, mock } from "bun:test";
globalThis.ran ??= "";
const val = v => typeof v === "function" ? "fn" : String(v);
const say = (...w) => console.log("SAID", ...w);
const tried = async read => { try { return String(await read()); } catch (e) { return "threw " + e.name; } };
test("b", async () => {
  vi.doMock("./part.mjs", () => ({ kept: 10 }));
  say("under", "barrel", await tried(async () => { const b = await import("./barrel.mjs"); return [Object.keys(b).join(), val(b.kept), val(b.left)].join("/"); }), "part", await tried(async () => { const b = await import("./part.mjs"); return [Object.keys(b).join(), val(b.kept), val(b.left)].join("/"); }), "user", await tried(async () => (await import("./user.mjs")).look()), "ran", globalThis.ran);
  vi.doUnmock("./part.mjs");
  say("behind", "barrel", await tried(async () => { const b = await import("./barrel.mjs"); return [Object.keys(b).join(), val(b.kept), val(b.left)].join("/"); }), "part", await tried(async () => { const b = await import("./part.mjs"); return [Object.keys(b).join(), val(b.kept), val(b.left)].join("/"); }), "user", await tried(async () => (await import("./user.mjs")).look()), "ran", globalThis.ran);
});
