function work() { return 1; }
function use(f, flag) {
  const first = f === null ? 0 : f();
  return [first, (f ? f() + 1 : "none")];
}
function tell(run) { try { return JSON.stringify(run()); } catch (error) { return error.constructor.name; } }
console.log(tell(() => use(work, true)));
console.log(tell(() => use(work, false)));
console.log(tell(() => use(undefined, true)));
console.log(tell(() => use(undefined, false)));
console.log(tell(() => use(null, true)));
console.log(tell(() => use(null, false)));
