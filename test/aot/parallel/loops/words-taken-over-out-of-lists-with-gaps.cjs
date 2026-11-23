// A pad takes words over out of a longer list, and only the bits of the pad's words are ever read: a place that the list lacks is stored as zero. Where the pad is asked for undefined, added up, handed out or joined, what it took stays what it was.
'use strict';
function stirred(list, n) {
  const pad = new Array(8);
  let a = 17, b = 5;
  for (let at = 0; at < n; at += 8) {
    for (let j = 0; j < 8; j++) pad[j] = list[at + j];
    for (let j = 0; j < 8; j++) { const v = pad[j] ^ (b << 3); b = (a >> 1) ^ pad[(j + 3) & 7]; a = v ^ (a << 2); }
    for (let j = 1; j < 8; j++) pad[j] = (pad[j] & 0xff00) | (pad[j - 1] >>> 4);
    a ^= pad[7] | pad[2]; b ^= ~pad[5];
  }
  return [a, b];
}
function added(list, n) { const pad = []; let a = 0; for (let at = 0; at < n; at += 4) { for (let j = 0; j < 4; j++) pad[j] = list[at + j]; for (let j = 0; j < 4; j++) a = (a ^ pad[j]) + pad[(j + 1) & 3]; } return [a]; }
function asked(list, n) { const pad = []; let a = 0, gone = 0; for (let at = 0; at < n; at += 4) { for (let j = 0; j < 4; j++) pad[j] = list[at + j]; for (let j = 0; j < 4; j++) { if (pad[j] === undefined) gone++; a ^= pad[j] << j; } } return [a, gone]; }
function kept(list, n) { const pads = []; let a = 0; for (let at = 0; at < n; at += 4) { const pad = []; for (let j = 0; j < 4; j++) { pad[j] = list[at + j]; a ^= pad[j] >> 1; } pads.push(pad); } return [a, pads.map(p => p.join('')).join('|'), pads.map(p => p.length + (1 in p ? 'y' : 'n')).join('')]; }
function behind(list, n) { const pad = [0, 0, 0, 0]; let a = 1; for (let i = 0; i < n; i++) { pad[i & 3] = list[i]; a = (a << 1) ^ pad[i & 3] ^ pad[(i + 2) & 3]; } return [a, typeof pad[1], String(pad[2])]; }
const counts = n => Array.from({ length: n }, (_, i) => Math.imul(i + 7, 2654435) >> (i & 7)), without = (n, ...at) => { const list = counts(n); for (const k of at) delete list[k]; return list; };
const told = run => { try { return run().map(v => Object.is(v, -0) ? '-0' : String(v)).join(','); } catch (error) { return error.constructor.name; } }, uses = { stirred, added, asked, kept, behind };
for (let k = 0; k < 150; k++) for (const use of Object.keys(uses)) uses[use](k % 3 ? counts(24) : without(24, k % 24, 11), 24);
const lists = { counts: () => counts(24), hole: () => without(24, 5), holes: () => without(24, 0, 7, 8, 9, 15, 23), short: () => counts(13), none: () => [], long: () => new Array(24), undefined: () => Object.assign(counts(24), { 6: undefined }), null: () => Object.assign(counts(24), { 6: null }), parts: () => counts(24).map(v => v + 0.75), great: () => counts(24).map(v => v * 2 ** 20), nan: () => Object.assign(counts(24), { 3: NaN, 9: Infinity }), zero: () => Object.assign(counts(24), { 2: -0 }), text: () => Object.assign(counts(24), { 4: '77', 12: 'x' }), big: () => Object.assign(counts(24), { 10: 5n }), bigs: () => counts(24).map(BigInt), object: () => Object.assign(counts(24), { 8: { valueOf: () => 99 } }), yes: () => Object.assign(counts(24), { 1: true }), view: () => new Int32Array(counts(24)), words: () => new Uint32Array(counts(24)), bytes: () => new Uint8Array(counts(13)), reals: () => new Float64Array(counts(20)), record: () => ({ 0: 5, 9: 6, 17: 7 }), letters: () => '123456789012345678901234', frozen: () => Object.freeze(without(24, 4)), heir: () => Object.setPrototypeOf(without(24, 4, 12), { __proto__: Array.prototype, 4: 1000, 12: 0.5 }), symbol: () => Object.assign(counts(24), { 14: Symbol.iterator }) };
for (const name of Object.keys(lists)) console.log(name, Object.keys(uses).map(use => told(() => uses[use](lists[name](), 24))).join(' | '));
for (const n of [0, 1, 8.5, '16', -4, NaN, null, undefined, true]) console.log(told(() => stirred(without(24, 3), n)), told(() => behind(without(24, 3), n)));
let asks = ''; const slow = without(24, 5); Object.defineProperty(slow, 10, { get() { asks += 'g'; slow.length = 12; return 4; } }); console.log(told(() => stirred(slow, 24)), asks, told(() => stirred(null, 8)), told(() => stirred(null, 0)), told(() => kept(undefined, 4))); const spied = []; stirred(new Proxy(without(8, 2), { get(o, k) { spied.push(String(k)); return o[k]; } }), 8); console.log(spied.join(''));
