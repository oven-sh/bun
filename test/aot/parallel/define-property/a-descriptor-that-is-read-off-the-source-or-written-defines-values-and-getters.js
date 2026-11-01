// `desc = Object.getOwnPropertyDescriptor(from, key); if (..) desc = { enumerable: true, get() { return from[key] } }; Object.defineProperty(to, key, desc)`: the layout of `to` plans for the written getter. Sources whose own descriptor is handed on define values and accessors in other forms.
"use strict";
function bind(to, from, key) {
  var desc = Object.getOwnPropertyDescriptor(from, key);
  if (!desc || ("get" in desc ? !from.marked : desc.writable || desc.configurable)) desc = { enumerable: true, get: function () { return from[key]; } };
  Object.defineProperty(to, key, desc);
}
function show(label, object) {
  const lines = [];
  for (const key of Reflect.ownKeys(object)) {
    const d = Object.getOwnPropertyDescriptor(object, key);
    lines.push(key + ":" + ("get" in d ? "get" + (d.set ? "+set" : "") : "value=" + (typeof d.value === "function" ? "function" : String(d.value)) + (d.writable ? "+w" : "")) + (d.enumerable ? "+e" : "") + (d.configurable ? "+c" : ""));
  }
  console.log(label, lines.join(" "), "|", Object.keys(object).join(), "|", JSON.stringify(object));
}
function attempt(label, action) {
  try { console.log(label, action()); } catch (error) { console.log(label, error.constructor.name); }
}

const plain = { add: function (a, b) { return a + b; }, two: 2 };
const ofPlain = {};
for (const key in plain) bind(ofPlain, plain, key);

const frozen = Object.freeze({ add: function (a, b) { return a * b; }, two: 20 });
const ofFrozen = {};
for (const key in frozen) bind(ofFrozen, frozen, key);

let hidden = 200;
const marked = { marked: true, get add() { return function (a, b) { return a - b; }; }, get two() { return hidden; }, set two(value) { hidden = value; } };
Object.defineProperty(marked, "unlisted", { get() { return "unlisted"; }, enumerable: false, configurable: false });
const ofMarked = {};
for (const key of Object.getOwnPropertyNames(marked)) bind(ofMarked, marked, key);

const unmarked = { get add() { return function (a, b) { return a / b; }; }, get two() { return 4; } };
const ofUnmarked = {};
for (const key in unmarked) bind(ofUnmarked, unmarked, key);

let kept = 5;
const fixed = { marked: true };
Object.defineProperty(fixed, "add", { get() { return function (a, b) { return a + b + kept; }; }, enumerable: true, configurable: false });
Object.defineProperty(fixed, "two", { get() { return kept; }, set(value) { kept = value; }, enumerable: true, configurable: false });
const ofFixed = {};
for (const key in fixed) bind(ofFixed, fixed, key);

const absent = {};
bind(absent, plain, "nothing");

function turn(object, i) { return object.add(i, object.two); }
for (const [label, object] of [["plain", ofPlain], ["frozen", ofFrozen], ["marked", ofMarked], ["unmarked", ofUnmarked], ["fixed", ofFixed]]) {
  let sum = 0;
  for (let i = 0; i < 100; i++) sum += turn(object, i);
  console.log(label, sum);
  show(label, object);
}
show("absent", absent);
console.log(absent.nothing, "nothing" in absent);

plain.two = 3;
console.log(ofPlain.two, turn(ofPlain, 1));
plain.add = function (a, b) { return a + b + 100; };
console.log(turn(ofPlain, 1));
delete plain.two;
console.log(ofPlain.two, String(turn(ofPlain, 1)));
ofMarked.two = 7;
console.log(hidden, ofMarked.two, marked.two);

ofFixed.two = 9;
console.log(kept, ofFixed.two, fixed.two, turn(ofFixed, 1));
attempt("store", () => { ofPlain.two = 1; return ofPlain.two; });
attempt("store frozen", () => { ofFrozen.two = 1; return ofFrozen.two; });
attempt("delete", () => delete ofPlain.add);
attempt("redefine", () => { Object.defineProperty(ofPlain, "add", { value: 1 }); return ofPlain.add; });
attempt("redefine alike", () => { Object.defineProperty(ofPlain, "add", { enumerable: true }); return typeof ofPlain.add; });
attempt("bind again", () => { bind(ofPlain, frozen, "add"); return ofPlain.add(2, 3); });
console.log(Object.getOwnPropertyDescriptor(ofPlain, "add").get === Object.getOwnPropertyDescriptor(ofPlain, "add").get, Object.getOwnPropertyDescriptor(ofMarked, "two").get === Object.getOwnPropertyDescriptor(marked, "two").get);
console.log(JSON.stringify({ ...ofFrozen, ...ofMarked }), JSON.stringify(Object.assign({}, ofUnmarked)), Object.entries(ofFrozen).length);
