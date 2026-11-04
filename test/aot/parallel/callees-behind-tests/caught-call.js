function work() { return 1; }
function use(f, flag) {
  let first = 0;
  try { if (f !== undefined) first = f(); } catch { first = -1; }
  return [first, flag, (f === undefined ? "U" : f === null ? "N" : f === false ? "F" : "other")];
}
function tell(run) { try { return JSON.stringify(run()); } catch (error) { return error.constructor.name; } }
for (const flag of [true, false]) {
  console.log(tell(() => use(work, flag)));
  console.log(tell(() => use(undefined, flag)));
  console.log(tell(() => use(null, flag)));
  console.log(tell(() => use(false, flag)));
}
