import { test, vi } from "bun:test";

// The numbers are jobs behind the second call of import(). The body goes on in the job that its file is named for.
const show = ns => `[${ns.v},${ns.f()},${vi.isMockFunction(ns.f)}]`;
const cases = [
  { job: 1, load: () => import("./job-1.mjs"), mock: () => vi.doMock("./job-1.mjs") },
  { job: 9, load: () => import("./job-9.mjs"), mock: () => vi.doMock("./job-9.mjs") },
  { job: 10, load: () => import("./job-10.mjs"), mock: () => vi.doMock("./job-10.mjs") },
  { job: 14, load: () => import("./job-14.mjs"), mock: () => vi.doMock("./job-14.mjs") },
];
for (const { job, load, mock } of cases) {
  test("the body goes on in job " + job, async () => {
    const notes = [];
    let jobs = -1;
    const note = word => notes.push(word + " " + jobs);
    const begun = Promise.withResolvers();
    const gate = Promise.withResolvers();
    Object.assign(globalThis, { note, begun: begun.resolve, gate: gate.promise });
    const first = load().then(
      ns => note("first" + show(ns)),
      error => note("first " + error.name),
    );
    await begun.promise;
    await new Promise(setImmediate);
    mock();
    jobs = 0;
    const tick = () => {
      if (++jobs === job) gate.resolve();
      if (jobs < 60) queueMicrotask(tick);
    };
    const second = load().then(
      ns => note("second" + show(ns)),
      error => note("second " + error.name),
    );
    queueMicrotask(tick);
    await Promise.all([first, second]);
    console.log("SAID", notes.join(" . "));
  });
}
