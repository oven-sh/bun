function work() { return 1; }
function use(v, flag) {
  const f = flag ? v : v;
  const first = f == null ? 0 : f();
  return [first, (f === undefined ? "U" : f === null ? "N" : f === false ? "F" : "other")];
}
function tell(run) { try { return JSON.stringify(run()); } catch (error) { return error.constructor.name; } }
console.log(tell(() => use(work, true)));
console.log(tell(() => use(work, false)));
console.log(tell(() => use(undefined, true)));
console.log(tell(() => use(undefined, false)));
console.log(tell(() => use(null, true)));
console.log(tell(() => use(null, false)));
console.log(tell(() => use(false, true)));
console.log(tell(() => use(false, false)));
