import { test, vi } from "bun:test";
const word = load => Promise.resolve(load).then(it => String(it.x ?? it.seen), error => error.name);
const asked = name => { try { const it = require(name); return String(it.x ?? it.seen); } catch (error) { return error.name; } };
const jobs = async n => { for (let job = 0; job < n; job++) await 0; };
test("a", async () => {
  const one = asked("./part.js"), two = asked("./part.js");
  globalThis.late.resolve({ x: "late mock" });
  await jobs(20);
  console.log("SAID", one, two, asked("./part.js"), await word(import("./part.js")), globalThis.calls, globalThis.ran ?? 0);
});
