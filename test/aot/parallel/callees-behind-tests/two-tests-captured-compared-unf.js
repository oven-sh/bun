function work() { return 1; }
function make(f) {
  return function use(flag) {
  let first = 0; if (f !== undefined && f !== null) first = f();
  return [first, (f === undefined ? "U" : f === null ? "N" : f === false ? "F" : "other")];
  };
}
function tell(run) { try { return JSON.stringify(run()); } catch (error) { return error.constructor.name; } }
console.log(tell(() => make(work)(true)));
console.log(tell(() => make(work)(false)));
console.log(tell(() => make(undefined)(true)));
console.log(tell(() => make(undefined)(false)));
console.log(tell(() => make(null)(true)));
console.log(tell(() => make(null)(false)));
console.log(tell(() => make(false)(true)));
console.log(tell(() => make(false)(false)));
