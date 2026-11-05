import { test, mock, vi } from "bun:test";
let calls = 0;
const show = all => all.map(r => r.status === "rejected" ? r.reason.message : "loaded " + (r.value.flag ?? r.value.seen?.() ?? r.value.default?.flag)).join();
vi.doMock("./dep.js", async () => { calls++; await 0; throw new Error("tardy " + calls); });
test("a", async () => {
  const first = import("./dep.js"); await null; const second = import("./dep.js");
  console.log("a", show(await Promise.allSettled([first, second])), calls);
});
