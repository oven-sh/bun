'use strict';
// Elements and arguments that nobody knows: instances of the few classes of the file that have the fields which are used first, and then whatever else has those fields, or some of them, or none.
class Lamp { constructor(x, power) { this.x = x; this.power = power; this.lit = 0; } }
class Motor { constructor(x, power, speed) { this.speed = speed; this.x = x; this.power = power; this.lit = 0; } }
class Pump { constructor(x, power) { this.power = power; this.x = x; this.lit = 1; this.volume = x * 4; } }
class Pipe { constructor(x) { this.x = x; this.volume = x; } }
const known = [new Lamp(1, 2), new Motor(3, 4, 5), new Pump(6, 7), new Lamp(8, 9.5), new Motor(-1, 0, 2)];
const odd = [{ x: 1, power: 2, lit: 3 }, { power: 5 }, new Pipe(3), Object.create(known[0]), Object.freeze(new Lamp(4, 4)), { get x() { return 10; }, power: 1, lit: 2 }, [1, 2], 'text', 7, Object.assign(Object.create(null), { lit: 1, x: 2, power: 3 }), new Proxy(new Pump(2, 3), {}), Object.defineProperty(new Motor(1, 1, 1), 'lit', { value: 9, writable: false })];
const bad = [null, undefined];
const say = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
function use(thing, n) { const x = thing.x, power = thing.power; if (power > 3) { thing.lit = n; return x * power; } return x - power; }
function over(list, n) { let s = 0; for (let i = 0; i < list.length; i++) { const t = list[i]; if (t.x > 2) s += t.power * n; else s -= t.x; t.lit = i; } return s; }
function keep(list) { const out = []; for (const t of list) if (t.power) out.push(use(t, out.length)); return out.join(); }
const given = JSON.parse('[0,1,2,3,4,1,0,2]');
for (let round = 0; round < 40; round++) { const list = given.map(i => known[i]); over(list, round); keep(list); }
console.log(over(given.map(i => known[i]), 3), keep(known), known.map(t => t.lit).join());
for (const t of odd) console.log(say(() => use(t, 5)), say(() => over([known[0], t, known[1]], 2)), say(() => keep([t, known[2]])), say(() => t.lit));
for (const t of bad) console.log(say(() => use(t, 1)), say(() => over([known[0], t], 1)), say(() => keep([t])));
delete known[0].power; known[1].x = 'text'; known[2].lit = {}; known[3].power = 1n;
console.log(say(() => over(known.slice(0, 3), 2)), say(() => keep(known.slice(0, 3))), say(() => over(known, 2)), say(() => use(known[3], 1)));
