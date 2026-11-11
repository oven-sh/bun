await new Promise(done => setTimeout(done, 20));
export const v = "a1";
globalThis.jobs = 0;
const tick = () => {
  if (++globalThis.jobs < 80) queueMicrotask(tick);
};
queueMicrotask(tick);
