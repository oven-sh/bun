function work() { return 1; }
function* inner(f, flag) {
  const first = f === undefined ? 0 : f();
  yield first;
  yield [flag, (f === undefined ? "U" : f === null ? "N" : f === false ? "F" : "other")];
}
function use(f, flag) { return [...inner(f, flag)]; }
function tell(run) { try { return JSON.stringify(run()); } catch (error) { return error.constructor.name; } }
for (const flag of [true, false]) {
  console.log(tell(() => use(work, flag)));
  console.log(tell(() => use(undefined, flag)));
  console.log(tell(() => use(null, flag)));
  console.log(tell(() => use(false, flag)));
}
