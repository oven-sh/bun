import { test, vi, mock } from "bun:test";
const wait = ms => new Promise(r => setTimeout(r, ms));
vi.mock("./a.js", async () => { await wait(5); return { a: 10 }; });
vi.mock("./b.js", async () => { await wait(1); throw new Error("late"); });
test("t", async () => { const p = import("./m1.js"), q = import("./m2.js").catch(e => e.message); console.log((await p).one(), String(await q).slice(0, 20)); });
