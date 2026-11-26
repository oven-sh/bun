// STATISTIC: HolesStoredAsZero >= 2
// What stands on a punch card is laid on a pad of the function's own, and nothing but the bits of the pad's places is read: where a card has a hole or ends, the pad may hold zero for it. A pad whose places are seen otherwise holds what the card says.
"use strict";
function mark(card, from, rounds) {
  const pad = Array(24);
  let mark = 7;
  let other = 11;
  for (let at = 0; at < rounds; at++) {
    const place = at % 24;
    pad[place] = card[from + at];
    mark = (mark << 3 ^ pad[place] ^ mark >>> 5) | 0;
    other = (other ^ pad[(place + 5) % 24] & 255) + at | 0;
    if (other > 1000) other = other >> 2 ^ mark & 15;
    mark = mark + (other & 7) | 0;
  }
  return mark ^ other;
}
function markOrdered(card, order) {
  const pad = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let mark = 1;
  for (let at = 0; at < order.length; at++) {
    pad[at & 15] = card[order[at]];
    mark = (mark << 1 ^ pad[at & 15]) + (pad[at + 3 & 15] & 63) | 0;
  }
  for (let at = 0; at < 16; at++) mark = mark * 3 ^ pad[at];
  return mark;
}
function markRow(card, order) {
  const pad = Array(16);
  let mark = 1;
  for (let at = 0; at < 16; at++) pad[at] = card[order[at]];
  for (let at = 0; at < 16; at++) mark = mark << 1 ^ pad[at];
  return mark;
}
function seen(card, order) {
  const pad = Array(16);
  let mark = 1;
  for (let at = 0; at < order.length; at++) {
    pad[at & 15] = card[order[at]];
    mark = (mark << 1 ^ pad[at + 3 & 15]) | 0;
  }
  let nothing = 0;
  for (let at = 0; at < 16; at++) if (pad[at] === undefined) nothing++;
  return mark + nothing;
}
const cards = [Array.from({ length: 80 }, (_, at) => at * 77 & 255), Array.from({ length: 80 }, (_, at) => at << 9), []];
for (let at = 0; at < 80; at++) if (at % 5) cards[2][at] = at * 3;
const order = Array.from({ length: 40 }, (_, at) => at * 11 % 80);
let all = 0;
for (let round = 0; round < 400; round++) {
  const card = cards[round % 3];
  all = all + mark(card, round % 9, 60) + markOrdered(card, order) + markRow(card, order) + seen(card, order) | 0;
}
console.log(all, cards.map(card => [mark(card, 0, 80), mark(card, 70, 40), mark(card, 79, 3), markOrdered(card, order), markRow(card, order), seen(card, order)].join()).join(" "));
