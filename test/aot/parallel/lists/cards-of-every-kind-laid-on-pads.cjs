// What stands on cards of every kind is laid on pads whose places are read for their bits alone, on one whose places are seen as they are, and on one that is handed out.
"use strict";
function mark(card, from, rounds) {
  const pad = Array(24);
  let mark = 7;
  let other = 11;
  for (let at = 0; at < rounds; at++) {
    const place = at % 24;
    pad[place] = card[from + at];
    mark = mark * 3 + (pad[place] & 1023) | 0;
    other = (other ^ pad[(place + 5) % 24] & 255) + at | 0;
    if (other > 1000) other = (other >> 2) - (mark & 15);
    mark = mark - (other & 7) | 0;
  }
  return mark ^ other;
}
function markOrdered(card, order) {
  const pad = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let mark = 1;
  for (let at = 0; at < order.length; at++) {
    pad[at & 15] = card[order[at]];
    mark = mark + (pad[at & 15] | 1) + (pad[at + 3 & 15] & 63) | 0;
  }
  for (let at = 0; at < 16; at++) mark = mark * 5 - (pad[at] >> 1) | 0;
  return mark;
}
function markRow(card, order) {
  const pad = Array(16);
  let mark = 1;
  for (let at = 0; at < 16; at++) pad[at] = card[order[at]];
  for (let at = 0; at < 16; at++) mark = mark << 1 ^ pad[at];
  return mark;
}
// one pad whose places are seen as they are, and one that is handed out
function seen(card, order) {
  const pad = Array(16);
  let mark = 1;
  for (let at = 0; at < order.length; at++) {
    pad[at & 15] = card[order[at]];
    mark = mark + (pad[at + 3 & 15] & 63) | 0;
  }
  let nothing = 0;
  for (let at = 0; at < 16; at++) if (pad[at] === undefined) nothing++;
  return mark + " " + nothing;
}
function handed(card, order) {
  const pad = Array(16);
  let mark = 1;
  for (let at = 0; at < order.length; at++) {
    pad[at & 15] = card[order[at]];
    mark = mark + (pad[at + 3 & 15] & 63) | 0;
  }
  return [mark, pad];
}
const cards = { bytes: Array.from({ length: 80 }, (_, at) => at * 77 & 255), words: Array.from({ length: 80 }, (_, at) => Math.imul(at, 0x1234567)), holes: [] };
for (let at = 0; at < 80; at++) if (at % 5) cards.holes[at] = at * 3;
const order = Array.from({ length: 40 }, (_, at) => at * 11 % 80);
const names = Object.keys(cards);
let all = 0;
for (let round = 0; round < 400; round++) {
  const card = cards[names[round % 3]];
  all = all + mark(card, round % 9, 60) + markOrdered(card, order) + markRow(card, order) | 0;
  if (round % 10 === 0) all = all + seen(card, order).length + handed(card, order)[0] | 0;
}
console.log(all);
let asked = 0;
Object.assign(cards, {
  fractions: Array.from({ length: 80 }, (_, at) => at * 1e9 / 3),
  floats: Float64Array.from({ length: 80 }, (_, at) => (at % 3 ? at / 2 : NaN)),
  clamped: Uint8ClampedArray.from({ length: 80 }, (_, at) => at * 5),
  short: [1, 2, 3],
  none: [],
  texts: Array.from({ length: 80 }, (_, at) => (at % 2 ? String(at) : "x" + at)),
  mixed: Array.from({ length: 80 }, (_, at) => [at, null, undefined, true, "12", at / 2, [at]][at % 7]),
  speaking: Array.from({ length: 80 }, (_, at) => ({ valueOf() { asked++; return at; } })),
  text: "0123456789012345678901234567890123456789",
  object: { 0: 5, 11: 6, 22: "7" },
});
const inherited = [];
inherited.length = 80;
Object.setPrototypeOf(inherited, Object.assign(Object.create(Array.prototype), { 3: 33, 11: 44 }));
cards.inherited = inherited;
cards.proxy = new Proxy(cards.bytes, { get(target, name) { asked++; return target[name]; } });
cards.long = [1n, 2n, 3n];
cards.nothing = undefined;
for (const [name, card] of Object.entries(cards)) {
  const said = [];
  for (const work of [() => mark(card, 0, 60), () => mark(card, 70, 30), () => markOrdered(card, order), () => markRow(card, order), () => markRow(card, [79, 80, -1, 1.5, "2", 0, 5, 10]), () => seen(card, order), () => { const [word, pad] = handed(card, order); return word + " " + pad.length + " " + pad.map(value => (typeof value === "object" && value ? "o" : typeof value + String(value))).join(); }]) {
    try {
      said.push(work());
    } catch (error) {
      said.push(error.constructor.name);
    }
  }
  console.log(name, said.join(" | "), asked);
}
