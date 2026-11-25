// A function that is written over Math.random is copied into loops: what it stores is undone where a turn goes back to the loop as it is written.
let state = 1, calls = 0; const log = [];
Math.random = function () { calls++; state = (state * 75 + 74) % 65537; log[calls & 7] = state; return state / 65537; };
function walk(steps, places) { let at = 0, sum = 0; for (let i = 0; i < steps; i++) { const r = Math.random(); at = r < 0.5 ? at + 1 : at - 1; if (at < 0) at = places.length - 1; if (at >= places.length) at = 0; sum += places[at]; } return sum + "/" + at; }
function thrown(n, f) { let last = 0; try { for (let i = 0; i < n; i++) { last = Math.random(); if (last > 0.9) f(i); } } catch (error) { return error.message + calls; } return last.toFixed(6); }
function fields(o, n) { for (let i = 0; i < n; i++) { o.x += Math.random(); o.n = o.n + 1; if (o.x > 2) o.x = o.x - 2; } return o.n + ":" + (typeof o.x === "number" ? o.x.toFixed(6) : o.x.length); }
function longer(n) { const out = []; for (let i = 0; i < n; i++) { if (Math.random() < 0.3) out.push(Math.random()); else if (out.length) out[out.length - 1] += 1; } return out.length + "/" + out.reduce((a, b) => a + b, 0).toFixed(6); }
for (let k = 0; k < 20; k++) { walk(30, [1, 2, 3]); fields({ x: 0, n: 0 }, 9); longer(12); }
console.log(walk(10, [1, 2, 3]), walk(10, [0.5, 2, 3]), walk(10, ["a", 1]), walk(9, [null, undefined, 4]), walk(5, []), state, calls, log.join());
console.log(thrown(50, i => { throw new Error("at " + i + " "); }), thrown(5, () => {}), fields({ x: 0, n: 2147483645 }, 8), fields({ x: "t", n: 0.5 }, 3), fields(Object.freeze({ __proto__: { set n(v) {}, get n() { return 3; } }, x: 1 }).x ? { x: 1, n: -0 } : {}, 4), longer(40), state, calls);
let turns = 0; const odd = { n: 0, get x() { if (++turns === 3) Math.random = () => 0.125; return turns; }, set x(v) { this.held = v; } }; console.log(fields(odd, 6), turns, odd.held, calls, walk(4, [5, 6]), calls);
class Dice { constructor(seed) { this.seed = seed; } roll() { this.seed = (this.seed * 31 + 7) & 1023; return this.seed / 1024; } } const dice = new Dice(3); Math.random = dice.roll.bind(dice); console.log(walk(12, [1, 2]), dice.seed, longer(9), dice.seed);
Math.random = dice.roll; try { console.log(walk(2, [1])); } catch (error) { console.log(error.constructor.name); } Math.seed = 5; console.log(walk(3, [1, 2, 3]), Math.seed); delete Math.seed;
