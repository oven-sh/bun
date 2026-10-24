// A lookup by key in a small object made right there, where the key is an object: it becomes a name by running code, which changes the object that is being asked, whether anybody uses the answer or not.
const lines = [];
const say = text => { lines.push(text); };
function unused(key) {
  const o = { a: 1, b: 2 };
  o[key];
  return o.a + o.b;
}
function unusedIn(key) {
  const o = { a: 1, b: 2 };
  key in o;
  return o.a + o.b;
}
function between(make) {
  const o = { a: 1, b: 2 };
  const key = make(o);
  const before = o.a;
  const found = o[key];
  return before + "," + o.a + "," + found;
}
function betweenIn(make) {
  const o = { a: 1, b: 2 };
  const key = make(o);
  const before = o.a;
  const found = key in o;
  return before + "," + o.a + "," + found + "," + Object.keys(o).join("+");
}
function twice(make) {
  const o = { a: 1, b: 2 };
  const key = make(o);
  return o[key] + "," + o[key] + "," + o.a;
}
function inLoop(make) {
  const o = { a: 1, b: 2 };
  const key = make(o);
  let sum = 0;
  for (let i = 0; i < 5; i++) sum += o[key] + o.a;
  return sum;
}
let count = 0;
const loud = { toString() { count++; say("converted " + count); return "a"; } };
const thrower = { toString() { throw new RangeError("no name"); } };
const makers = [
  o => ({ toString() { o.a += 10; return "b"; } }),
  o => ({ toString() { o.a += 10; return "a"; } }),
  o => ({ toString() { delete o.a; return "a"; } }),
  o => ({ toString() { o.c = 3; return "c"; } }),
  o => ({ [Symbol.toPrimitive]() { o.a = "text"; return "a"; } }),
  o => ({ toString() { Object.defineProperty(o, "a", { get() { say("getter ran"); return 99; }, configurable: true }); return "a"; } }),
  o => ({ valueOf() { o.a = -1; return "b"; }, toString: null }),
  o => ({ toString() { Object.setPrototypeOf(o, { z: "z above" }); return "z"; } }),
  () => "__proto__",
  () => Symbol.iterator,
  () => 0,
  () => null,
];
for (let turn = 0; turn < 3; turn++) {
  say("unused " + unused(loud) + " " + unusedIn(loud) + " " + count);
  for (const run of [unused, unusedIn]) {
    try {
      say("thrower " + run(thrower));
    } catch (error) {
      say("threw " + error.name);
    }
  }
  for (const make of makers) {
    for (const run of [between, betweenIn, twice, inLoop]) {
      try {
        say(run.name + " " + String(run(make)));
      } catch (error) {
        say(run.name + " threw " + error.name);
      }
    }
  }
}
console.log(lines.join("\n"));
