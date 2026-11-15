import { test, vi, mock } from "bun:test";
const wait = ms => new Promise(r => setTimeout(r, ms));
const say = async (n, f) => { try { console.log(n, await f()); } catch (e) { console.log(n, e.name, e.message.replace(/"[^"]*"/g, "..").slice(0, 60)); } };
vi.mock("./a.js", async o => { await wait(5); return { a: (await o()).a + 10 }; });
vi.mock("./b.js", async () => { await wait(1); return { b: 21 }; });
test("a", async () => { await say("load", async () => (await import("./m1.js")).sum()); await say("twice", async () => (await import("./m1.js")).sum()); });
