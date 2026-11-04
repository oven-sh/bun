function work() { return 1; }
function use(f, flag) {
  const first = f === undefined ? 0 : f();
  return [first, String(f).slice(0, 9)];
}
function tell(run) { try { return JSON.stringify(run()); } catch (error) { return error.constructor.name; } }
console.log(tell(() => use(work, true)));
console.log(tell(() => use(work, false)));
console.log(tell(() => use(undefined, true)));
console.log(tell(() => use(undefined, false)));
console.log(tell(() => use(null, true)));
console.log(tell(() => use(null, false)));
