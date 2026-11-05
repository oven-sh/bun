import { test, mock, vi } from "bun:test";
let calls = 0;
const show = all => all.map(r => r.status === "rejected" ? r.reason.message : "loaded " + (r.value.flag ?? r.value.seen?.() ?? r.value.default?.flag)).join();
mock.module("./dep.js", async () => { calls++; await 0; throw new Error("tardy " + calls); });
test("a", async () => {
  console.log("a", show(await Promise.allSettled([import("./dep.js"), import("./dep.js"), import("./user.js")])), calls);
});
