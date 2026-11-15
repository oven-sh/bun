// A counter that starts behind the bound it is compared with, stepped in front of the test.
const list2 = [0, 1, 2, 3, 4, 5, 6, 7], seen = []; class V { constructor(x) { this.x = x; this.t = 0; } } let runs = 0;
class G { constructor(x) { this.q = x; this.t = 0; } get x() { runs++; return this.q; } }
function* _g() {}
function f(p, i, n, o) { let s = 0, t = 0, k = 0, turns = 0; const list = [p, p, p, p]; while (true) { p.t++; const j = i++; if (j === 6) return [s, t, i]; s += j < n ? 1 : 7; if (++turns > 40) break; } return [s, t, i, turns]; }
globalThis.kinds = [V, G, f];
const makes = [() => new V(1), () => new G(2), () => ({ x: 3, t: 0 }), () => ({ t: 1 }), () => Object.freeze(new V(4)), () => new Proxy(new V(5), {}), () => Object.create(new V(6)), () => { const p = new V(7); Object.defineProperty(p, "x", { get() { runs++; return 8; } }); return p; }];
const go = (p, i, n, o) => { try { return String(f(p, i, n, o)); } catch (e) { return "T" + e.name; } };
for (let turn = 0; turn < 3; turn++) for (const make of makes) for (const [i, n] of [[0, 5], [9, 5], [6, 5], [5, 5], [-3, 5], [0, 6], [7, 6], [100, 6], [0.5, 3], [-1, -4], [2, 9], [2 ** 31 - 2, 4]]) console.log(turn, go(make(), i, n, { n, at: 0 }));
for (let turn = 0; turn < 300; turn++) go(makes[turn % 8](), turn % 9, 5, { n: 5, at: 0 });
console.log(go(new G(3), 9, 5, { n: 5, at: 0 }), go(new V(3), 9, 5, { n: 5, at: 0 }), runs, seen.length);
