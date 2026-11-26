// Sums of words out of a list and of words carried round a loop end in a truncation: the elements that only such sums take are asked for integers and added whole; what is boxed, missing, a fraction or too great is added as written. Bounds lie under masks, and the list that the loop extends is its own.
'use strict';
function grow(seed, n) { const bag = new Array(n); for (let i = 0; i < n; i++) { if (i < seed.length) bag[i] = seed[i] | 0; else { const a = bag[i - 2], b = bag[(i - 5) & 31]; bag[i] = (bag[i - 1] + (a ^ (a >>> 9)) + ((b << 4) | (b >>> 28)) + i * 40503) | 0; } } return bag; }
function turn(state, bag, keys, rounds) {
  let t = state[4], s = state[3], q = state[1], r = state[2], p = state[0];
  for (let i = 0; i < rounds; i++) {
    const mixed = (t + (p ^ (q & r)) + ((s << 11) | (s >>> 21)) + keys[i & 15] + bag[i]) | 0;
    const other = ((q | s) + (r ^ bag[(i + 3) & 31]) - keys[(i * 5) & 15]) | 0;
    t = s; s = (r + other) | 0; r = (q << 7) | (q >>> 25); q = p; p = (mixed + other) | 0;
  }
  state[3] = (s + state[3]) | 0; state[1] = (q - state[1]) | 0; state[4] = (state[4] ^ t) + p | 0; state[0] = (state[0] + p) | 0; state[2] = (r + state[2]) | 0;
  return state;
}
function single(bag, n) { let w = 0; for (let i = 0; 32 > i && i < n; i++) w = (w + bag[i] * 2 - bag[i & 7] + (bag[i] >> 1)) | 0; return w; }
function untruncated(bag, n) { let w = 0; for (let i = 0; i < n; i++) w = w + bag[i] + (bag[i & 3] | 0); return w; }
function arms(bag, n) { let w = 1; for (let i = 0; i < n; i++) { let v = (w << 3) + bag[i]; if (i % 4 === 1) v += bag[i - 1]; else if (w < 0) v -= 77; w = v | 0; } return w; }
const keys = Array.from({ length: 16 }, (_, i) => Math.imul(i + 1, 0x9e3) ^ (i << 20)), fresh = () => [1, -2, 3 << 20, 0x7fffffff, -0x80000000], told = run => { try { const v = run(); return Array.isArray(v) ? v.join(',') : Object.is(v, -0) ? '-0' : String(v); } catch (error) { return error.constructor.name; } };
for (let k = 0; k < 100; k++) { const bag = grow([k, k * 3, -k, 7, 9], 32); turn(fresh(), bag, keys, 32); single(bag, 32); untruncated(bag, 8); arms(bag, 32); }
const bag = grow([5, 6, 7, 8, 9], 32); console.log(told(() => turn(fresh(), bag, keys, 32)), single(bag, 32), untruncated(bag, 8), arms(bag, 32), bag.slice(-3).join());
const odd = { hole: b => { delete b[9]; }, undefined: b => { b[9] = undefined; }, part: b => { b[9] = 1.75; }, great: b => { b[9] = 2 ** 33 + 5; }, huge: b => { b[9] = 2 ** 53; }, below: b => { b[9] = -(2 ** 40) - 3; }, nan: b => { b[9] = NaN; }, zero: b => { b[9] = -0; }, text: b => { b[9] = '12'; }, word: b => { b[9] = 'x'; }, none: b => { b[9] = null; }, yes: b => { b[9] = true; }, big: b => { b[9] = 3n; }, object: b => { b[9] = { valueOf: () => 2 ** 31 }; }, short: b => { b.length = 20; }, frozen: b => { Object.freeze(b); }, getter: b => { let n = 0; Object.defineProperty(b, 9, { get: () => ++n * 1e9 }); } };
for (const name of Object.keys(odd)) { const b = grow([5, 6, 7, 8, 9], 32); odd[name](b); console.log(name, told(() => turn(fresh(), b, keys, 32)), told(() => single(b, 32)), told(() => untruncated(b, 12)), told(() => arms(b, 32)), told(() => turn([0.5, '3', null, undefined, NaN], b, keys, 3))); }
const views = [new Int32Array(bag), new Uint32Array(bag), new Float64Array(bag), new Uint8Array(bag), new Float32Array(bag), new Int16Array(bag)]; console.log(views.map(v => told(() => turn(fresh(), v, keys, 32)) + ' ' + single(v, 32) + ' ' + untruncated(v, 32) + ' ' + arms(v, 32)).join('\n'));
console.log(told(() => turn(new Int32Array(5), bag, keys, 40)), told(() => turn(fresh(), bag, keys.map(k => k + 0.5), 32)), told(() => turn(fresh(), bag, [1, 2], 32)), told(() => turn(fresh(), bag, keys, 2.5)), told(() => turn(fresh(), bag, keys, '3')), told(() => turn(fresh(), bag, keys, -1)), told(() => turn(null, bag, keys, 1)), told(() => turn(fresh(), null, keys, 1)), told(() => turn(fresh(), null, keys, 0)));
console.log(told(() => grow([1.9, -1.9, '7', null, 2 ** 35], 12)), told(() => grow([], 6)), told(() => grow([1n], 3)), told(() => single([], 4)), told(() => untruncated([0.1, 0.2, 0.3], 3)), told(() => arms(['a'], 2)), told(() => single(bag, 100)));
