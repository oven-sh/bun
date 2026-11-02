// `const it = list[Symbol.iterator](); for (let r = it.next(); !r.done; r = it.next())`, and the helpers that TypeScript emits for ES5, which do the same.
// An iterator of a list yields what the list holds when it is asked, whichever of keys, values and entries made it, wherever it has been in between.
var __values = function (o) {
  var s = typeof Symbol === "function" && Symbol.iterator,
    m = s && o[s],
    i = 0;
  if (m) return m.call(o);
  if (o && typeof o.length === "number")
    return {
      next: function () {
        if (o && i >= o.length) o = void 0;
        return { value: o && o[i++], done: !o };
      },
    };
  throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
};
var __read = function (o, n) {
  var m = typeof Symbol === "function" && o[Symbol.iterator];
  if (!m) return o;
  var i = m.call(o),
    r,
    ar = [],
    e;
  try {
    while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
  } catch (error) {
    e = { error: error };
  } finally {
    try {
      if (r && !r.done && (m = i["return"])) m.call(i);
    } finally {
      if (e) throw e.error;
    }
  }
  return ar;
};
function drain(it) {
  let text = "";
  for (let r = it.next(); !r.done; r = it.next()) text += String(r.value) + ";";
  return text + String(it.next().done);
}
function values(list) {
  let text = "";
  const it = list[Symbol.iterator]();
  for (let r = it.next(); !r.done; r = it.next()) text += String(r.value) + ";";
  return text;
}
function keys(list) {
  let sum = 0;
  const it = list.keys();
  for (let r = it.next(); !r.done; r = it.next()) sum += r.value;
  return sum;
}
function entries(list) {
  let text = "";
  const it = list.entries();
  for (let r = it.next(); !r.done; r = it.next()) text += r.value[0] + "=" + String(r.value[1]) + ";";
  return text;
}
function oneOfThree(list, which) {
  const it = which === 0 ? list.keys() : which === 1 ? list.values() : list.entries();
  return drain(it);
}
function grownUnderTheWalk(list) {
  let text = "";
  const it = list.values();
  for (let r = it.next(); !r.done; r = it.next()) {
    text += r.value + ";";
    if (list.length < 6) list.push(list.length * 10);
  }
  return text;
}
function cutUnderTheWalk(list) {
  let text = "";
  const it = list.values();
  for (let r = it.next(); !r.done; r = it.next()) {
    text += r.value + ";";
    list.length = 2;
  }
  list.push(7, 8, 9);
  return text + String(it.next().done);
}
function startedThenHandedOn(list) {
  const it = list.values();
  const first = it.next().value;
  return first + "|" + drain(it);
}
function twoOverOneList(list) {
  const a = list.values(),
    b = list.values();
  a.next();
  return String(a.next().value) + String(b.next().value) + String(a === b) + String(a[Symbol.iterator]() === a);
}
function spreadAfterOneStep(list) {
  const it = list.values();
  it.next();
  return [...it].join() + "|" + [...it].length;
}
function byHelper(list) {
  var e_1, _a;
  var text = "";
  try {
    for (var l = __values(list), step = l.next(); !step.done; step = l.next()) text += String(step.value) + ";";
  } catch (e_1_1) {
    e_1 = { error: e_1_1 };
  } finally {
    try {
      if (step && !step.done && (_a = l.return)) _a.call(l);
    } finally {
      if (e_1) throw e_1.error;
    }
  }
  return text;
}
function pairByHelper(i) {
  var _a = __read([i & 7, i & 3, 9], 2),
    a = _a[0],
    b = _a[1];
  return a + b + _a.length;
}
class Doubled extends Array {
  *[Symbol.iterator]() {
    for (let i = 0; i < this.length; i++) yield this[i] * 2;
  }
}
const lists = () => [
  [1, 2, 3, 4],
  [0.5, 1.5],
  ["a", "b", "c"],
  [],
  [1, , 3],
  [undefined, null],
  [{ toString: () => "o" }, [5, 6]],
  Object.freeze([7, 8]),
  Doubled.from([1, 2]),
  new Array(3),
];
const lines = [];
let check = 0;
for (let round = 0; round < 3000; round++) {
  check += keys([1, 2, 3, 4]) + values([round & 7, 2]).length + pairByHelper(round);
  const list = lists()[round % 10];
  const line = [
    values(list),
    keys(list),
    entries(list),
    oneOfThree(list, round % 3),
    byHelper(list),
    startedThenHandedOn(list),
    twoOverOneList(list),
    spreadAfterOneStep(list),
    grownUnderTheWalk([1, 2]),
    cutUnderTheWalk([1, 2, 3, 4]),
  ].join(" | ");
  if (round < 30 || round % 997 === 0) lines.push(line);
}
lines.push(drain(Array.prototype.values.call({ length: 2, 0: "x", 1: "y" })));
lines.push(drain(Array.prototype.entries.call("ab")));
lines.push(
  drain(new Uint8Array([4, 5]).values()),
  byHelper(new Uint8Array([6, 7])),
  byHelper("xyz"),
  byHelper({ length: 2, 0: "p", 1: "q" }),
);
for (const bad of [undefined, null]) {
  try {
    Array.prototype.values.call(bad);
  } catch (error) {
    lines.push(error.constructor.name);
  }
}
try {
  [].values().next.call({});
} catch (error) {
  lines.push(error.constructor.name);
}
console.log(check);
console.log(lines.join("\n"));
