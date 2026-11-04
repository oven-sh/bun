function work() { return 1; }
async function inner(f, flag) {
  const first = f === undefined ? 0 : await f();
  await null;
  return [first, flag, (f === undefined ? "U" : f === null ? "N" : f === false ? "F" : "other")];
}
function use(f, flag) { inner(f, flag).then(v => console.log(JSON.stringify(v)), e => console.log(e.constructor.name)); return 0; }
function tell(run) { try { return JSON.stringify(run()); } catch (error) { return error.constructor.name; } }
for (const flag of [true, false]) {
  console.log(tell(() => use(work, flag)));
  console.log(tell(() => use(undefined, flag)));
  console.log(tell(() => use(null, flag)));
  console.log(tell(() => use(false, flag)));
}
