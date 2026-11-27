// STATISTIC: XorsUnderBitsFolded >= 4
// A ticket has bits, and each bit changes some of the lamps over a turnstile: where nothing but an exclusive or stands under the question for one bit, the bit itself makes the mask and the branch goes. Bits of every place, the sign among them, and tickets that are no int32s.
"use strict";
function lamps(tickets, from) {
  let lit = from;
  for (let at = 0; at < tickets.length; at++) {
    const ticket = tickets[at];
    if (ticket & 1) lit ^= 0x155;
    if (ticket & 8) lit = lit ^ 0x2a00;
    lit = lit + 3 | 0;
    if (ticket & 0x40) lit = (lit << 1) ^ 0x71;
    else lit = lit << 1;
  }
  return lit;
}
function signs(tickets, from) {
  let lit = from | 0;
  for (let at = 0; at < tickets.length; at++) {
    const ticket = tickets[at] | 0;
    if (ticket & 0x80000000) lit ^= -1;
    if (ticket & 0x40000000) lit ^= 0x7fffffff;
    if ((ticket & 2) !== 0) lit = lit ^ -2147483648;
    if ((ticket & 4) === 0) lit = lit + at | 0;
    else lit = lit + at ^ 0x0f0f;
    if (!(ticket & 0x10000)) lit = lit ^ 12345;
  }
  return lit;
}
// the same under questions for more than one bit, which are no masks
function others(tickets, from) {
  let lit = from | 0;
  for (let at = 0; at < tickets.length; at++) {
    const ticket = tickets[at];
    if (ticket & 3) lit ^= 0x33;
    if ((ticket & 8) === 8) lit ^= 0x44;
    if ((ticket & 16) > 0) lit ^= 0x55;
    if (ticket & (1 << at % 32)) lit ^= 0x66;
    if (ticket & 32) lit ^= at;
    if (ticket & 64) lit = (lit >>> 1) ^ 0x77;
    else lit = lit >> 1;
  }
  return lit;
}
// one ticket of which every bit is asked in turn
function byBits(ticket) {
  let lit = 0;
  for (let round = 0; round < 3; round++) {
    if (ticket & 1) lit ^= 1;
    if (ticket & 2) lit ^= 2;
    if (ticket & 0x100) lit ^= 0x10000;
    if (ticket & 0x20000000) lit ^= 0x100;
    if (ticket & -2147483648) lit ^= 0x40000000;
    lit = lit << 1 | lit >>> 31;
  }
  return lit;
}
const rows = {
  words: Int32Array.from({ length: 40 }, (_, at) => Math.imul(at + 1, 0x9e3779b1)),
  bytes: Array.from({ length: 40 }, (_, at) => at * 31 & 255),
  fractions: Array.from({ length: 20 }, (_, at) => at * 1e9 / 3 - 2e9),
  floats: Float64Array.from([0, -0, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32 + 8, -(2 ** 31) - 1, 2 ** 53, 1e300]),
  strange: ["8", null, undefined, true, "x", "0x40", [1], { valueOf: () => 65 }],
  holes: [1, , 8, , 64],
};
let all = 0;
for (let round = 0; round < 400; round++) {
  const row = round % 2 ? rows.words : rows.bytes;
  all = all + lamps(row, round) + signs(row, -round) + others(row, round) + byBits(row[round % 40]) | 0;
}
console.log(all);
for (const [name, row] of Object.entries(rows)) console.log(name, lamps(row, 5), lamps(row, -1), signs(row, 2147483647), others(row, 77), Array.from(row, byBits).join(" "));
for (const ticket of [0, 1, -1, 2147483647, -2147483648, 4294967295, 0.5, "257", null, NaN]) console.log(String(ticket), byBits(ticket), lamps([ticket], 0), signs([ticket, ticket], 1), others([ticket], -1));
for (const strange of [1n, Symbol.iterator]) {
  for (const work of [lamps, signs, others]) {
    try {
      console.log(work([3, strange], 1));
    } catch (error) {
      console.log(work.name, error.constructor.name);
    }
  }
}
