"use strict";
const hide = value => [value][JSON.parse("0")];
const words = JSON.parse('["stone","river and hill","été über","жук in a box","",  "q"]');
function read(holder, at) {
  return holder.text.charCodeAt(at) + ":" + holder.text.codePointAt(at);
}
const out = [];
for (let round = 0; round < 12; round++) {
  for (const first of words) {
    for (const second of words) {
      const sum = hide(first) + "-" + hide(second);
      const kept = { text: sum };
      out.push(hide(read)(hide(kept), sum.length), hide(read)(hide(kept), -1), hide(read)(hide(kept), round));
      const whole = hide(first) + "+" + hide(second) + "+" + round;
      const piece = { text: whole.slice(1, whole.length - 1) };
      const inner = { text: piece.text.slice(round % 3, piece.text.length - 1) };
      for (let at = 0; at < 14; at++) out.push(hide(read)(hide(piece), at), hide(read)(hide(inner), at));
      out.push(hide(read)(hide(inner), inner.text.length - 1), hide(read)(hide(inner), inner.text.length), inner.text);
    }
  }
}
let hash = 7;
for (const value of out) for (let at = 0; at < value.length; at++) hash = (hash * 31 + value.charCodeAt(at)) % 1000003;
console.log(out.length, hash, out.slice(100, 112).join(" "));
