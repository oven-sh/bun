// Behind the count of key orders that a layout numbers an object keeps its order beside its structure. Its keys are listed once for such an order and handed out as a copy-on-write list.
// Every list handed out is a list of its own to whoever writes into it, and it follows what is added to and deleted from the object.
"use strict";
const turns = Number(process.argv[2] ?? 6000);
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
for (let mask = 0; mask < 8192; mask++) warmed += Object.keys(make(mask)).length;
const texts = new Map();
let sum = 0;
for (let turn = 0; turn < turns; turn++) {
  const mask = (turn * 7919 + 3) & 63;
  const made = backwards(mask);
  const keys = Object.keys(made);
  sum = (sum + keys.length) % 1000003;
  const text = keys.join();
  const before = texts.get(mask);
  if (before !== undefined && before !== text) console.log("ANOTHER LIST", mask, before, text);
  texts.set(mask, text);
  if (turn % 5 === 0) keys.push("written into the list");
  if (turn % 7 === 0) keys[0] = "replaced";
  if (turn % 11 === 0) {
    made.m = 1;
    const longer = Object.keys(made).join();
    if (longer !== text + ",m") console.log("NOT FOLLOWED", mask, text, longer);
  }
  if (turn % 13 === 0 && mask & 4) {
    delete made.c;
    const shorter = Object.keys(made);
    if (shorter.includes("c") || shorter.length !== Object.getOwnPropertyNames(made).length) console.log("STILL LISTED", mask, shorter.join());
  }
  if (turn % 1000 === 0) Bun.gc(true);
}
console.log(warmed, sum, texts.size, texts.get(63), texts.get(5), texts.get(40), Object.getOwnPropertyNames(backwards(21)).join(), Reflect.ownKeys(backwards(42)).join(), JSON.stringify(Object.entries(backwards(9))));
