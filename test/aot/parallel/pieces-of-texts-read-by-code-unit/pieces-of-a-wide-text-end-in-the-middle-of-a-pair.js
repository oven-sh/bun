"use strict";
const hide = value => [value][JSON.parse("0")];
const wide = JSON.parse(JSON.stringify("ab\u{1F600}cd\u{1F601}\u{1F602}efЖ\uD83Dgh\uDE00ij\u{10FFFF}kl"));
const cuts = [
  (text, from, to) => text.slice(from, to),
  (text, from, to) => text.substring(from, to),
  (text, from, to) => text.substr(from, to - from),
  (text, from, to) => text.slice(from).slice(0, to - from),
];
function unitAt(holder, at) {
  return holder.text.charCodeAt(at);
}
function pointAt(holder, at) {
  return holder.text.codePointAt(at);
}
const out = [];
for (let round = 0; round < 3; round++) {
  for (const cut of cuts) {
    for (let from = 0; from < wide.length; from++) {
      for (let to = from; to <= wide.length; to += 1 + (round + from) % 3) {
        const holder = { text: hide(cut)(hide(wide), from, to) };
        const units = [];
        const points = [];
        for (let at = -1; at <= to - from; at++) {
          units.push(hide(unitAt)(hide(holder), at));
          points.push(hide(pointAt)(hide(holder), at));
        }
        out.push(units.join("."), points.join("."));
      }
    }
  }
}
let hash = 7;
for (const value of out) for (let at = 0; at < value.length; at++) hash = (hash * 31 + value.charCodeAt(at)) % 1000003;
console.log(out.length, hash, out[3], out[40], out[41], out[out.length - 9]);
