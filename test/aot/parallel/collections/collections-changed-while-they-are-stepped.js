// Loops over maps and sets whose tables grow, shrink, are cleared, widened and replaced while they are stepped.
const lines = [];
function report(name, ...values) {
  lines.push(name + ": " + values.map(String).join(" "));
}

const written = new Map([["a", 1], ["bb", 2], ["ccc", 3]]);
function lengthsAndValues(turns) {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) {
    for (const key of written.keys()) total += key.length;
    for (const value of written.values()) total += value;
    for (const [key, value] of written) total += key.length * value;
  }
  return total;
}
report("written", lengthsAndValues(40));

const mixed = new Map([["a", 1], [2, "two"], [null, undefined], [true, 1.5], [-0, -0]]);
function kinds() {
  let text = "";
  for (const key of mixed.keys()) text += typeof key + (Object.is(key, 0) ? "0" : "") + ",";
  for (const value of mixed.values()) text += typeof value + (Object.is(value, -0) ? "-0" : "") + ",";
  return text;
}
report("kinds", kinds());

function growing(size, at, added) {
  const map = new Map();
  for (let i = 0; i < size; i++) map.set("k" + i, i);
  let steps = 0, total = 0;
  for (const [key, value] of map) {
    if (steps === at) for (let i = 0; i < added; i++) map.set("new" + i, 1000 + i);
    total += key.length + value;
    steps++;
  }
  return steps + "/" + total;
}
for (const size of [1, 3, 4, 5, 8, 9, 40, 300]) for (const added of [1, 4, 30, 400]) report("growing " + size + " " + added, growing(size, size >> 1, added));

function widened(size, at) {
  const map = new Map();
  for (let i = 0; i < size; i++) map.set("k" + i, "v" + i);
  let text = "", steps = 0;
  for (const key of map.keys()) {
    if (steps++ === at) {
      map.set(0.5, "half");
      map.set("last", 2.5);
    }
    text += String(key).slice(-2);
  }
  for (const value of map.values()) text += String(value).slice(-2);
  return text;
}
for (const size of [2, 4, 7, 12]) report("widened " + size, widened(size, 0), widened(size, size - 1));

function emptied(size, at, again) {
  const set = new Set();
  for (let i = 0; i < size; i++) set.add(i % 2 ? "t" + i : i);
  let steps = 0, text = "";
  for (const member of set) {
    text += member + ";";
    if (steps++ === at) {
      set.clear();
      for (let i = 0; i < again; i++) set.add("again" + i);
    }
    if (steps > 60) break;
  }
  return text + set.size;
}
for (const size of [1, 4, 9, 33]) report("emptied " + size, emptied(size, 0, 0), emptied(size, size >> 1, 3), emptied(size, size - 1, 20));

function deleted(size, keep) {
  const map = new Map();
  for (let i = 0; i < size; i++) map.set(i, i * 2);
  let total = 0, steps = 0;
  for (const key of map.keys()) {
    for (let i = key + 1; i < size; i++) if (i % keep) map.delete(i);
    total += key;
    steps++;
  }
  for (const value of map.values()) total += value;
  return steps + "/" + total + "/" + map.size;
}
for (const size of [3, 8, 20, 64, 200]) report("deleted " + size, deleted(size, 2), deleted(size, 7));

function bothAtOnce(map, set) {
  let text = "";
  for (const key of map.keys()) {
    for (const member of set) {
      text += key === member ? "=" : ".";
      if (member === 2) set.add(key);
      if (key === "x") map.delete("y");
    }
  }
  return text + map.size + set.size;
}
report("both", bothAtOnce(new Map([["x", 1], ["y", 2], [2, 3]]), new Set([1, 2, "x"])), bothAtOnce(new Map(), new Set([1])), bothAtOnce(new Map([["x", 1]]), new Set()));

function replaced(turns) {
  let map = new Map([["a", 1]]), total = 0;
  for (let turn = 0; turn < turns; turn++) {
    for (const [key, value] of map) {
      total += value;
      map = new Map([["a", value + 1], [turn, 2]]);
      if (key === turn) break;
    }
  }
  return total;
}
report("replaced", replaced(12));

function leftEarly(map) {
  const found = [];
  for (const wanted of [1, 2, 3, 9]) {
    for (const [key, value] of map) {
      if (value !== wanted) continue;
      found.push(key);
      break;
    }
  }
  try {
    for (const value of map.values()) if (value === 2) throw new Error("two");
  } catch (error) {
    found.push(error.message);
  }
  return found.join();
}
report("left", leftEarly(written), leftEarly(mixed));

const keys = [{}, [], () => 1, Symbol("s"), new Date(0)];
const weak = new WeakMap();
function weakValues(turns) {
  let total = 0, same = 0;
  for (let turn = 0; turn < turns; turn++) {
    const key = keys[turn % keys.length];
    if (weak.set(key, turn % 3 ? turn : { turn }) === weak) same++;
    const value = weak.get(key);
    total += typeof value === "number" ? value : value.turn;
    if (turn % 7 === 6) weak.delete(key);
  }
  return total + "/" + same;
}
report("weak", weakValues(50));
for (const key of [1, "text", null, undefined, Symbol.for("registered")]) {
  try {
    for (let turn = 0; turn < 3; turn++) weak.set(key, turn);
    report("weak " + String(key), "stored");
  } catch (error) {
    report("weak " + String(key), error.constructor.name);
  }
}

const state = Symbol("state"), other = Symbol();
const record = { [state]: 1, a: 2, get [other]() { return this[state] + 1; } };
function readState(turns) {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) {
    total += record[state] + record.a + record[other];
    if (turn === 3) record[state] = 2;
    if (turn === 5) delete record.a;
    if (turn === 6) record.a = 0.5;
  }
  return total;
}
report("state", readState(9), Object.getOwnPropertySymbols(record).length, JSON.stringify(record));
console.log(lines.join("\n"));
