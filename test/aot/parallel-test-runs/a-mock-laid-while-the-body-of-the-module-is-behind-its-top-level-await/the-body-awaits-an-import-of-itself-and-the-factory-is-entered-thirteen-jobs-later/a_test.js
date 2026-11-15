import { test, vi } from "bun:test";
let jobs = -1;
const notes = [];
const count = () => {
  jobs = 0;
  const tick = () => {
    if (++jobs < 90) queueMicrotask(tick);
  };
  queueMicrotask(tick);
};
// The numbers are jobs behind the call of import() that the body of slow.mjs awaits. When the body goes on is left out: compiled, it goes on later than under `bun test`.
test("the jobs behind the call", async () => {
  let open;
  globalThis.gate = new Promise(done => {
    open = done;
  });
  globalThis.warm = () => {
    count();
    return import("./slow.mjs");
  };
  const begun = Promise.withResolvers();
  globalThis.begin = begun.resolve;
  const first = import("./slow.mjs");
  first.catch(() => {});
  await begun.promise;
  vi.doMock("./slow.mjs", async original => {
    notes.push("entered " + jobs);
    const real = await original();
    notes.push("has the original " + jobs + " " + real.late);
    return { late: "mocked" };
  });
  open();
  const own = await first;
  console.log("SAID", own.late, "|", notes.join(" . "));
}, 12000);
