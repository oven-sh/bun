import { test } from "bun:test";
const val = v => typeof v === "function" ? "fn" : String(v), say = (...w) => console.log("SAID", ...w), tried = async read => { try { return String(await read()); } catch (e) { return "threw " + e.name; } };
test("a", async () => {
  say("load", await tried(async () => (await import("./user.js")).user()));
});
