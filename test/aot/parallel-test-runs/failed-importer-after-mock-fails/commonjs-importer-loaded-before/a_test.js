import { vi, mock, test } from "bun:test";
let calls = 0;
const tried = async read => { try { return String(await read()); } catch (e) { return "threw " + String(e.message).replace(/\/\S*\//g, "").slice(0, 40); } };
const U = async () => console.log("| U:", await tried(async () => (await import("./user.js")).seen()), "| calls", calls);
const M = async () => console.log("| M:", await tried(async () => (await import("./dep.cjs")).flag), "| calls", calls);
const rejects = () => vi.doMock("./dep.cjs", async () => { calls++; await 0; throw new Error("tardy " + calls); });
const throwsNow = () => vi.doMock("./dep.cjs", () => { calls++; throw new Error("sudden " + calls); });
const module2 = () => mock.module("./dep.cjs", () => ({ flag: "module2" }));
const doMock2 = () => vi.doMock("./dep.cjs", () => ({ flag: "doMock2" }));
const doMock3 = () => vi.doMock("./dep.cjs", () => ({ flag: "doMock3" }));
const unmock = () => vi.doUnmock("./dep.cjs");
const over = () => vi.doMock("./dep.cjs", async original => ({ ...(await original()), flag: "over" }));
const throwsOver = () => vi.doMock("./dep.cjs", original => { calls++; throw new Error("sudden over " + calls); });
const R = async () => console.log("| R:", await tried(() => import.meta.require("./user.js").seen()), "| calls", calls);
const Q = async () => console.log("| Q:", await tried(() => import.meta.require("./dep.cjs").flag), "| calls", calls);
// doMock2 U throwsNow U M U
test("first", async () => {
  doMock2();
  await U();
  throwsNow();
  await U();
  await M();
  await U();
});
