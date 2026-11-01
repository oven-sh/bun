// Two result shapes share a property that is a number in one and a boolean in the other, and pass through a second function before the caller reads them.
"use strict";
const kept = [];
function show(x) {
  return typeof x === "object" && x !== null ? JSON.stringify(x) : String(x);
}
function make(i) {
  if (i % 2 === 0) return { tag: 0, v: i / 4, f00: [i, 1], f01: i };
  return { tag: 1, v: (i & 2) === 0, f10: i, f11: (i & 2) === 0 };
}
function again(i) {
  const first = make(i);
  if (first.tag === 0) return first;
  return { tag: 1, v: (i & 2) === 0, f10: i, f11: (i & 2) === 0 };
}
function use(i) {
  let text = "";
  const r = again(i);
  text += Object.keys(r).join();
  text +=
    r.tag === 0
      ? show(r.tag) + show(r.v) + show(r.f00) + show(r.f01) + ""
      : show(r.tag) + show(r.v) + show(r.f10) + show(r.f11) + "";
  if (i % 17 === 0) text += JSON.stringify(r);
  return text;
}
let hash = 0,
  sample = "";
for (let i = 0; i < 3000; i++) {
  const t = use(i);
  for (let j = 0; j < t.length; j++) hash = (hash * 31 + t.charCodeAt(j)) | 0;
  if (i < 12) sample += t + "|";
}
console.log(hash, sample, JSON.stringify(kept).length, JSON.stringify(kept.slice(0, 3)));
