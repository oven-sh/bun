// Stores that add properties to arguments objects of every kind.
const say = (...values) => console.log(...values.map(value => (typeof value === "string" ? value : JSON.stringify(value))));
const attempt = body => {
  try {
    return body();
  } catch (error) {
    return error.constructor.name + ": " + error.message;
  }
};
const own = object => Reflect.ownKeys(object).map(String).join();
function plain() { return arguments; }
function mapped(a, b) { a = "changed"; return arguments; }
function mappedLater(a, b) { const held = arguments; held.tag = a; b = "second"; return held; }
function captured(a, b) { const set = value => { a = value; }; set("captured"); return arguments; }
function defaults(a = 1, b) { return arguments; }
function rest(a, ...others) { return arguments; }
const strictOnes = require("node:vm").runInThisContext("(function () { 'use strict'; return arguments; })");
class Strict { static get(a, b) { return arguments; } }
const kinds = { plain, mapped, mappedLater, captured, defaults, rest, strict: Strict.get, outside: strictOnes };

function add(object, i) {
  object.tag = i;
  object.other = [i];
  return object;
}
for (const [name, make] of Object.entries(kinds)) {
  let last;
  for (let i = 0; i < 60; i++) last = add(make(i, "two", "three"), i);
  say(name, own(last), last.length, last[0], last[1], last.tag, last.other, Array.from(last), Object.prototype.toString.call(last));
}

function addInLoop(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const o = plain(i, 2);
    o.tag = i;
    sum += o.tag + o[0] + o.length;
  }
  return sum;
}
say("addInLoop", addInLoop(300));

const names = ["0", "1", "2", "7", "-1", "01", "1.5", "length", "callee", "caller", "constructor", "toString", "then", "__proto__", "4294967295"];
for (const [kind, make] of Object.entries(kinds)) {
  for (const key of names) {
    let found;
    for (let i = 0; i < 4; i++) {
      const object = make(1, 2);
      const result = attempt(() => { object[key] = "new" + i; });
      object.after = i;
      found = [result === undefined ? "stored" : result.split(":")[0], own(object), attempt(() => String(object[key])).split(":")[0], attempt(() => Array.from(object).length)];
    }
    say(kind, key, found);
  }
}
function setLength(object) { object.length = 1; object.tag = 1; return object; }
function setIterator(object) { object[Symbol.iterator] = function* () { yield "own"; }; object.tag = 2; return object; }
function setCallee(object) { object.callee = "c"; object.tag = 3; return object; }
for (const [kind, make] of Object.entries(kinds)) {
  for (let i = 0; i < 5; i++) {
    const results = [setLength, setIterator, setCallee].map(change => attempt(() => { const object = change(make("a", "b")); return [own(object), [...object], object.length]; }));
    if (i === 4) say("special", kind, results);
  }
}
for (const [kind, make] of Object.entries(kinds)) {
  for (let i = 0; i < 9; i++) {
    const object = make(1, 2);
    const seen = [];
    if (i % 3 === 1) Object.setPrototypeOf(object, { set tag(value) { seen.push(value); } });
    if (i % 3 === 2) Object.freeze(object);
    const result = attempt(() => { object.tag = i; });
    if (i > 5) say("prototype", kind, i % 3, seen, Object.prototype.hasOwnProperty.call(object, "tag"), result === undefined ? "" : result.split(":")[0]);
  }
}
function deletes(object, i) {
  object.a = 1;
  object.b = 2;
  if (i & 1) delete object.a;
  delete object[0];
  object.c = 3;
  object.a = 4;
  object[0] = "back";
  return object;
}
for (const [kind, make] of Object.entries(kinds)) {
  let last;
  for (let i = 0; i < 6; i++) last = deletes(make("x", "y"), i);
  say("deleted", kind, own(last).split(",").sort(), last[0], last.a);
}
function many(object) {
  for (let k = 0; k < 80; k++) object["n" + k] = k;
  return object;
}
for (const [kind, make] of Object.entries(kinds)) {
  const object = many(make(1));
  Bun.gc(true);
  say("many", kind, Reflect.ownKeys(object).length, object.n79, object[0]);
}
const kept = [];
for (let i = 0; i < 120; i++) {
  const object = kinds[Object.keys(kinds)[i % 8]]({ i }, "t");
  object.label = { deep: "deep" + i };
  if (i % 12 === 0) kept.push(object);
  if (i % 40 === 0) Bun.gc(true);
}
Bun.gc(true);
say("kept", kept.map(object => [object.label.deep, object.length]));
