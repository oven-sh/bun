import { test, mock, vi } from "bun:test";
let calls = 0, others = 0;
const show = all => all.map(r => r.status === "rejected" ? r.reason.message : "loaded " + (r.value.flag ?? r.value.seen?.() ?? r.value.default?.flag)).join();
mock.module("./dep.js", async () => { calls++; await 0; throw new Error("tardy " + calls); });
test("a", async () => {
  const both = await Promise.allSettled([import("./dep.js"), import("./dep.js")]);
  console.log("a", both[0].reason === both[1].reason, calls);
});
