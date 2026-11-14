import { test, vi } from "bun:test";
test("counts the jobs to the factory", async () => {
  let called = false, taken = false;
  vi.doMock("./r.mjs", async original => {
    called = true;
    const { v } = await original();
    taken = true;
    return { v: "over " + v };
  });
  const call = import("./r.mjs");
  let jobs = 0, calledAfter = -1;
  while (!taken && jobs < 40) {
    await 0;
    jobs++;
    if (called && calledAfter < 0) calledAfter = jobs;
  }
  console.log("SAID", calledAfter, taken ? jobs : "later", (await call).v);
});
