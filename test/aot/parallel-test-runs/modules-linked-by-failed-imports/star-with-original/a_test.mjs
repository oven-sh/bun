import { test, vi, mock } from "bun:test";
import fs from "node:fs";
globalThis.ran ??= "";
const val = v => typeof v === "function" ? "fn" : String(v);
const say = (...w) => console.log("SAID", ...w);
const tried = async read => { try { return String(await read()); } catch (e) { return "threw " + e.name; } };
test("a", async () => {
  say("pre", await tried(async () => (await import("./part.mjs")).kept));
  fs.writeFileSync(import.meta.dir + "/written.mjs", 'import { nope } from "./barrel.mjs";\nexport const seen = nope;\n'); const file = "./written.mjs"; say("fail", await tried(async () => (await import(file)).seen)); fs.rmSync(import.meta.dir + "/written.mjs");
  vi.doMock("./part.mjs", async original => ({ ...await original(), kept: 10 }));
  say("under", "barrel", await tried(async () => { const b = await import("./barrel.mjs"); return [Object.keys(b).join(), val(b.kept), val(b.left)].join("/"); }), "part", await tried(async () => { const b = await import("./part.mjs"); return [Object.keys(b).join(), val(b.kept), val(b.left)].join("/"); }), "user", await tried(async () => (await import("./user.mjs")).look()), "ran", globalThis.ran);
  vi.doUnmock("./part.mjs");
  say("behind", "barrel", await tried(async () => { const b = await import("./barrel.mjs"); return [Object.keys(b).join(), val(b.kept), val(b.left)].join("/"); }), "part", await tried(async () => { const b = await import("./part.mjs"); return [Object.keys(b).join(), val(b.kept), val(b.left)].join("/"); }), "user", await tried(async () => (await import("./user.mjs")).look()), "ran", globalThis.ran);
});
