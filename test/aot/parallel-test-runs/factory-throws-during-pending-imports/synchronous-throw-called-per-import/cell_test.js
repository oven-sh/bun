import { test, mock, vi } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
setTimeout(() => { console.log("SAID still waiting"); process.exit(4); }, 3000).unref();
const rounds = async n => { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)); };
const turns = async n => { for (let i = 0; i < n; i++) await null; };
const word = it => it.status === "rejected" ? "threw " + String(it.reason && it.reason.message !== undefined ? it.reason.message : it.reason) : "came " + (it.value.seen ? it.value.seen() : it.value.value);
let calls = 0;
const throws = () => { calls++; throw new Error("made up " + calls); };
const tell = (settled, ...more) => console.log("SAID calls", calls, "same", settled.length > 1 && settled.every(it => it.status === "rejected" && it.reason === settled[0].reason), settled.map(word).join(" ; "), ...more);
test("cell", async () => {
  mock.module("./mocked.mjs", throws);
  tell(await Promise.allSettled([import("./mocked.mjs"), import("./user.mjs")]));
});
