// A layout numbers a bounded count of key orders. Behind that bound an object keeps its order beside its structure.
// The same field added to the same order is the same step: it is looked up, not made again. Every order has to come out as written all the same.
// COUNT: counter:KeyOrdersStoredOutOfLine <= 3000
"use strict";
const turns = Number(process.argv[2] ?? 20000);
function make(mask) {
  const made = { id: mask };
  if (mask & 1) made.a = mask;
  if (mask & 2) made.b = mask;
  if (mask & 4) made.c = mask;
  if (mask & 8) made.d = mask;
  if (mask & 16) made.e = mask;
  if (mask & 32) made.f = mask;
  if (mask & 64) made.g = mask;
  if (mask & 128) made.h = mask;
  if (mask & 256) made.i = mask;
  if (mask & 512) made.j = mask;
  if (mask & 1024) made.k = mask;
  if (mask & 2048) made.l = mask;
  if (mask & 4096) made.m = mask;
  return made;
}
function backwards(mask) {
  const made = { id: mask };
  if (mask & 32) made.f = mask;
  if (mask & 16) made.e = mask;
  if (mask & 8) made.d = mask;
  if (mask & 4) made.c = mask;
  if (mask & 2) made.b = mask;
  if (mask & 1) made.a = mask;
  return made;
}
let warmed = 0;
for (let mask = 0; mask < 8192; mask++) warmed += make(mask).id;
const texts = new Map();
let sum = 0;
for (let turn = 0; turn < turns; turn++) {
  const mask = (turn * 7919 + 3) & 63;
  const made = backwards(mask);
  sum = (sum + made.id) % 1000003;
  if (turn % 97 === 0 || turn < 128) {
    const text = Object.keys(made).join() + "|" + JSON.stringify(made);
    const before = texts.get(mask);
    if (before !== undefined && before !== text) console.log("ANOTHER ORDER", mask, before, text);
    texts.set(mask, text);
  }
}
console.log(warmed, sum, texts.size, texts.get(63), texts.get(5), texts.get(40));
