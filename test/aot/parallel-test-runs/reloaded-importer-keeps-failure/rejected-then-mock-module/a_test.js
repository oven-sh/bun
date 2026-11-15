import { vi, mock, test } from "bun:test";
let calls = 0;
const tried = async read => { try { return String(await read()); } catch (e) { return "threw " + String(e.message).replace(/\/\S*\//g, "").slice(0, 40); } };
const U = async () => console.log("| U:", await tried(async () => (await import("./user.js")).seen()), "| calls", calls);
const M = async () => console.log("| M:", await tried(async () => (await import("./dep.js")).flag), "| calls", calls);
const rejects = () => vi.doMock("./dep.js", async () => { calls++; await 0; throw new Error("tardy " + calls); });
const throwsNow = () => vi.doMock("./dep.js", () => { calls++; throw new Error("sudden " + calls); });
const module2 = () => mock.module("./dep.js", () => ({ flag: "module2" }));
const doMock2 = () => vi.doMock("./dep.js", () => ({ flag: "doMock2" }));
const doMock3 = () => vi.doMock("./dep.js", () => ({ flag: "doMock3" }));
const unmock = () => vi.doUnmock("./dep.js");
const over = () => vi.doMock("./dep.js", async original => ({ ...(await original()), flag: "over" }));
const throwsOver = () => vi.doMock("./dep.js", original => { calls++; throw new Error("sudden over " + calls); });
const R = async () => console.log("| R:", await tried(() => import.meta.require("./user.js").seen()), "| calls", calls);
const Q = async () => console.log("| Q:", await tried(() => import.meta.require("./dep.js").flag), "| calls", calls);
// doMock2 U rejects U M module2 U
test("first", async () => {
  doMock2();
  await U();
  rejects();
  await U();
  await M();
  module2();
  await U();
});
