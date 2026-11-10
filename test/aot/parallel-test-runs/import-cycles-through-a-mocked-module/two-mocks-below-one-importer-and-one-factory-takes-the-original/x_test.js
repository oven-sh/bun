import { test, vi } from "bun:test";
const wait = ms => new Promise(r => setTimeout(r, ms));
const say = async (n, f) => { try { console.log(n, await f()); } catch (e) { console.log(n, e.name, e.message.slice(0, 40)); } };
vi.mock("./a.js", async original => { await wait(5); return { a: (await original()).a + 10 }; });
vi.mock("./b.js", async () => { await wait(1); return { b: 21 }; });
test("a", async () => { await say("load", async () => (await import("./m1.js")).sum()); });
