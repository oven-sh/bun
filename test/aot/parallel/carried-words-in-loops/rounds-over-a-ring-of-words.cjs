'use strict';
// Rounds of a constant number of turns: the words of one turn are others of the next, a ring of words lies under a masked counter. Blocks, rings and states of every kind, one array in two places, words past 32 bits, loops that are left in the middle.
function stir(block, ring, state) {
  let a = state[0], b = state[1], c = state[2], d = state[3];
  for (let i = 0; i < 32; i++) {
    const w = i < 8 ? (ring[i] = block[i] | 0) : (ring[i & 7] = (ring[i - 3 & 7] ^ ring[i - 5 & 7]) + (ring[i & 7] << 9 | ring[i & 7] >>> 23) | 0);
    const next = (a << 7 | a >>> 25) + (b & c | ~b & d) + w + 0x1234567 | 0;
    a = d + 1 | 0; d = c; c = b ^ b >>> 13; b = next;
  }
  state[0] = state[0] + a | 0; state[1] = state[1] + b | 0; state[2] = state[2] + c | 0; state[3] = state[3] + d | 0;
}
function open(block, state, until) {
  let a = state[0], b = state[1], c = state[2];
  for (let i = 0; i < 20; i++) {
    if (i === until) return i + ':' + a + ':' + b;
    const t = a + (b ^ c) + block[i & 3];
    a = b; b = c; c = t * 3 % 4294967296;
    if (c > 4e9) break;
  }
  return a + ':' + b + ':' + c;
}
function three(block, key) {
  let x = key[0], y = key[1], z = key[2];
  for (let i = 0; i < 24; i += 3) {
    x = (x + (y << 4 ^ z >>> 5) ^ block[i % 6]) >>> 0;
    y = (y + (z << 4 ^ x >>> 5) ^ block[(i + 1) % 6]) >>> 0;
    z = (z + (x << 4 ^ y >>> 5) ^ block[(i + 2) % 6]) >>> 0;
  }
  key[0] = x; key[1] = y; key[2] = z;
}
const block = { whole: () => [1, 2, 3, 4, 5, 6, 7, 8], big: () => [4294967295, 2 ** 40 + 5, -1, 2147483648, 1e15, 0, -2147483648, 77], parts: () => [.5, 1.75, -2.5, 3, 4, 5, 6, 7], short: () => [9, 8], holes: () => [1, , 3, , 5, 6, 7, 8], view: () => new Int32Array([5, 4, 3, 2, 1, 0, -1, -2]), bytes: () => new Uint8Array([250, 4, 3, 2, 1, 0, 9, 8]), floats: () => new Float64Array([1.5, 2, 3, 4, 5, 6, 7, 8]), text: () => '12345678', mixed: () => [1, 'x', null, undefined, {}, true, NaN, '6'] };
const ring = { list: () => [], known: () => new Array(8).fill(0), view: () => new Int32Array(8), unsigned: () => new Uint32Array(8), narrow: () => new Uint8Array(8), plain: () => ({}), parts: () => [.5, .5, .5] };
const state = { whole: () => [1, 2, 3, 4], view: () => new Int32Array([7, 6, 5, 4]), unsigned: () => new Uint32Array([4294967295, 1, 2, 3]), parts: () => [.5, 1.5, 2.5, 3.5], fixed: () => Object.freeze([1, 2, 3, 4]), none: () => [] };
const show = l => Array.from({ length: 4 }, (_, i) => String(l[i])).join();
for (const b of Object.keys(block)) for (const s of Object.keys(state)) {
  const said = [];
  for (const r of Object.keys(ring)) { try { const t = state[s](), w = block[b](); stir(w, ring[r](), t); stir(w, ring[r](), t); said.push(show(t)); } catch (e) { said.push(e.constructor.name); } }
  for (const f of [() => { const t = state[s](), w = block[b](); stir(w, w, t); return show(t) + show(w); }, () => { const t = state[s](); stir(t, t, t); return show(t); }, () => open(block[b](), state[s](), 7), () => open(block[b](), state[s](), -1), () => { const t = state[s](); three(block[b](), t); three(block[b](), t); return show(t); }]) { try { said.push(f()); } catch (e) { said.push(e.constructor.name); } }
  console.log(b, s, said.join(' '));
}
