import { test, vi } from "bun:test";
const word = load => Promise.resolve(load).then(it => String(it.x ?? it.seen), error => error.name);
const asked = name => { try { const it = require(name); return String(it.x ?? it.seen); } catch (error) { return error.name; } };
const jobs = async n => { for (let job = 0; job < n; job++) await 0; };
test("a", async () => {
  console.log("SAID", asked("./user.cjs"), asked("./user.cjs"), globalThis.calls, globalThis.ran ?? 0);
});
