import { test, vi, mock } from "bun:test";
const wait = ms => new Promise(r => setTimeout(r, ms));
vi.mock("./a.js", async () => { await wait(5); return { a: 10 }; });
vi.mock("./b.js", async () => { await wait(1); return { b: 20 }; });
test("t", async () => { const [x, y] = await Promise.all([import("./m1.js"), import("./m2.js")]); console.log(x.one(), y.two()); });
