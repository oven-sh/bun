// An untyped package and a program of it (clones): clone, merge, equality, differences, paths, freezing and mapping over anything
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
class P { constructor(x) { this.x = x; } get double() { return this.x * 2; } } const cyc = { n: 1, list: [1, , 3] }; cyc.self = cyc; cyc.list.push(cyc); const s = Symbol('s'); const err = new TypeError('m'); err.code = 'E';
const all = [1, 'a', null, undefined, [1, [2, { a: 3 }]], new P({ y: 1 }), cyc, new Date(5e11), /a(b)/gi, new Map([[{ k: 1 }, new Set([1, [2]])]]), new Set(['x', { y: 1 }]), new Uint8Array([1, 2, 3]), new Float64Array([NaN, -0]), err, { [s]: 1, get g() { return this.h; }, h: 4 }, Object.freeze({ f: [1] }), Object.create(null), [, 1, , 2]];
const show = v => { const seen = new Set(); return JSON.stringify(v, (k, x) => x && typeof x === 'object' ? seen.has(x) ? 'cycle' : (seen.add(x), x instanceof Map ? ['map', ...x] : x instanceof Set ? ['set', ...x] : x) : typeof x === 'number' && !Number.isFinite(x) ? String(x) : x); };
all.forEach((v, i) => { const c = lib.clone(v); say(i, lib.tag(c), show(c), c === v, lib.equal(v, c), v && typeof v === 'object' ? Object.getPrototypeOf(c) === Object.getPrototypeOf(v) : '-', v && v.length); });
say(lib.clone(cyc).self.self.list[3].n, lib.clone(all[14])[s], lib.clone(all[14]).g, all.map((a, i) => all.map(b => lib.equal(a, b) ? 1 : 0).join('')).join(' '), 1 in lib.clone(all[17]));
