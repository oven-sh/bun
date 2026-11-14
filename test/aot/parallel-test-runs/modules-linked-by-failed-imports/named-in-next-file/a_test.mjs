import { test, vi, mock } from "bun:test";
import fs from "node:fs";
globalThis.ran ??= "";
const val = v => typeof v === "function" ? "fn" : String(v);
const say = (...w) => console.log("SAID", ...w);
const tried = async read => { try { return String(await read()); } catch (e) { return "threw " + e.name; } };
test("a", async () => {
  fs.writeFileSync(import.meta.dir + "/written.mjs", 'import { nope } from "./barrel.mjs";\nexport const seen = nope;\n'); const file = "./written.mjs"; say("fail", await tried(async () => (await import(file)).seen)); fs.rmSync(import.meta.dir + "/written.mjs");
});
