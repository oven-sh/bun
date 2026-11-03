// A built-in hands on what a member of its operand returns. The member may return its receiver, here beside a second call of the built-in whose member returns something else.
const show = made => [typeof made.count, made.label, Object.keys(made).join("+"), "added" in made].join(" ");
function arrayToStringOther() {
  return Array.prototype.toString.call({ join() { return "x"; } });
}
function arrayToStringAdds() {
  const made = { count: () => 1, join() { return this; }, label: "two" };
  const again = Array.prototype.toString.call(made);
  again.added = 1;
  return (again === made) + " " + show(made);
}
function arrayToStringFreezes() {
  const made = { count: () => 1, join() { return this; }, label: "two" };
  const again = Array.prototype.toString.call(made);
  Object.freeze(again);
  try {
    made.label = "three";
  } catch {}
  return (again === made) + " " + show(made);
}
function arrayToStringSets() {
  const made = { count: () => 1, join() { return this; }, label: "two" };
  const again = Array.prototype.toString.call(made);
  Reflect.set(again, "count", 4);
  return (again === made) + " " + show(made);
}
function arrayToStringDeletes() {
  const made = { count: () => 1, join() { return this; }, label: "two" };
  const again = Array.prototype.toString.call(made);
  delete again.count;
  return (again === made) + " " + show(made);
}
function objectToLocaleStringOther() {
  return Object.prototype.toLocaleString.call({ toString() { return "x"; } });
}
function objectToLocaleStringAdds() {
  const made = { count: () => 1, toString() { return this; }, label: "two" };
  const again = Object.prototype.toLocaleString.call(made);
  again.added = 1;
  return (again === made) + " " + show(made);
}
function objectToLocaleStringFreezes() {
  const made = { count: () => 1, toString() { return this; }, label: "two" };
  const again = Object.prototype.toLocaleString.call(made);
  Object.freeze(again);
  try {
    made.label = "three";
  } catch {}
  return (again === made) + " " + show(made);
}
function objectToLocaleStringSets() {
  const made = { count: () => 1, toString() { return this; }, label: "two" };
  const again = Object.prototype.toLocaleString.call(made);
  Reflect.set(again, "count", 4);
  return (again === made) + " " + show(made);
}
function objectToLocaleStringDeletes() {
  const made = { count: () => 1, toString() { return this; }, label: "two" };
  const again = Object.prototype.toLocaleString.call(made);
  delete again.count;
  return (again === made) + " " + show(made);
}
function dateToJSONOther() {
  return Date.prototype.toJSON.call({ toISOString() { return "x"; } });
}
function dateToJSONAdds() {
  const made = { count: () => 1, toISOString() { return this; }, label: "two" };
  const again = Date.prototype.toJSON.call(made);
  again.added = 1;
  return (again === made) + " " + show(made);
}
function dateToJSONFreezes() {
  const made = { count: () => 1, toISOString() { return this; }, label: "two" };
  const again = Date.prototype.toJSON.call(made);
  Object.freeze(again);
  try {
    made.label = "three";
  } catch {}
  return (again === made) + " " + show(made);
}
function dateToJSONSets() {
  const made = { count: () => 1, toISOString() { return this; }, label: "two" };
  const again = Date.prototype.toJSON.call(made);
  Reflect.set(again, "count", 4);
  return (again === made) + " " + show(made);
}
function dateToJSONDeletes() {
  const made = { count: () => 1, toISOString() { return this; }, label: "two" };
  const again = Date.prototype.toJSON.call(made);
  delete again.count;
  return (again === made) + " " + show(made);
}
function regExpMatchOther() {
  return RegExp.prototype[Symbol.match].call({ exec() { return null; } }, "a");
}
function regExpMatchAdds() {
  const made = { count: () => 1, exec() { return this; }, label: "two" };
  const again = RegExp.prototype[Symbol.match].call(made, "a");
  again.added = 1;
  return (again === made) + " " + show(made);
}
function regExpMatchFreezes() {
  const made = { count: () => 1, exec() { return this; }, label: "two" };
  const again = RegExp.prototype[Symbol.match].call(made, "a");
  Object.freeze(again);
  try {
    made.label = "three";
  } catch {}
  return (again === made) + " " + show(made);
}
function regExpMatchSets() {
  const made = { count: () => 1, exec() { return this; }, label: "two" };
  const again = RegExp.prototype[Symbol.match].call(made, "a");
  Reflect.set(again, "count", 4);
  return (again === made) + " " + show(made);
}
function regExpMatchDeletes() {
  const made = { count: () => 1, exec() { return this; }, label: "two" };
  const again = RegExp.prototype[Symbol.match].call(made, "a");
  delete again.count;
  return (again === made) + " " + show(made);
}
function promiseCatchOther() {
  return Promise.prototype.catch.call({ then() { return "x"; } });
}
function promiseCatchAdds() {
  const made = { count: () => 1, then() { return this; }, label: "two" };
  const again = Promise.prototype.catch.call(made);
  again.added = 1;
  return (again === made) + " " + show(made);
}
function promiseCatchFreezes() {
  const made = { count: () => 1, then() { return this; }, label: "two" };
  const again = Promise.prototype.catch.call(made);
  Object.freeze(again);
  try {
    made.label = "three";
  } catch {}
  return (again === made) + " " + show(made);
}
function promiseCatchSets() {
  const made = { count: () => 1, then() { return this; }, label: "two" };
  const again = Promise.prototype.catch.call(made);
  Reflect.set(again, "count", 4);
  return (again === made) + " " + show(made);
}
function promiseCatchDeletes() {
  const made = { count: () => 1, then() { return this; }, label: "two" };
  const again = Promise.prototype.catch.call(made);
  delete again.count;
  return (again === made) + " " + show(made);
}
function promiseFinallyOther() {
  return Promise.prototype.finally.call({ then() { return "x"; } });
}
function promiseFinallyAdds() {
  const made = { count: () => 1, then() { return this; }, label: "two" };
  const again = Promise.prototype.finally.call(made);
  again.added = 1;
  return (again === made) + " " + show(made);
}
function promiseFinallyFreezes() {
  const made = { count: () => 1, then() { return this; }, label: "two" };
  const again = Promise.prototype.finally.call(made);
  Object.freeze(again);
  try {
    made.label = "three";
  } catch {}
  return (again === made) + " " + show(made);
}
function promiseFinallySets() {
  const made = { count: () => 1, then() { return this; }, label: "two" };
  const again = Promise.prototype.finally.call(made);
  Reflect.set(again, "count", 4);
  return (again === made) + " " + show(made);
}
function promiseFinallyDeletes() {
  const made = { count: () => 1, then() { return this; }, label: "two" };
  const again = Promise.prototype.finally.call(made);
  delete again.count;
  return (again === made) + " " + show(made);
}
if (process.argv.length > 5) console.log(arrayToStringOther(), objectToLocaleStringOther(), dateToJSONOther(), regExpMatchOther(), promiseCatchOther(), promiseFinallyOther());
for (const run of [arrayToStringAdds, arrayToStringFreezes, arrayToStringSets, arrayToStringDeletes, objectToLocaleStringAdds, objectToLocaleStringFreezes, objectToLocaleStringSets, objectToLocaleStringDeletes, dateToJSONAdds, dateToJSONFreezes, dateToJSONSets, dateToJSONDeletes, regExpMatchAdds, regExpMatchFreezes, regExpMatchSets, regExpMatchDeletes, promiseCatchAdds, promiseCatchFreezes, promiseCatchSets, promiseCatchDeletes, promiseFinallyAdds, promiseFinallyFreezes, promiseFinallySets, promiseFinallyDeletes]) {
  let last;
  for (let round = 0; round < 3; round++) last = run();
  console.log(run.name, last);
}
