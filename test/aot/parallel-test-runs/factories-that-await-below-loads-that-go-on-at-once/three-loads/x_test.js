import { test, vi, mock } from "bun:test";
const wait = ms => new Promise(r => setTimeout(r, ms));
vi.mock("./a.js", async () => { await wait(5); return { a: 10 }; });
vi.mock("./b.js", async () => { await wait(1); return { b: 20 }; });
vi.mock("./c.js", async () => { await wait(3); return { c: 30 }; });
test("t", async () => { const all = await Promise.all([import("./m1.js"), import("./m2.js"), import("./m3.js")]); console.log(all[0].one(), all[1].two(), all[2].three()); });
