// Small methods that read fields of their receiver and call other small functions are copied into loops; a parameter that a function only reckons with, in both arms of a choice and in the functions that it hands it on to, is asked once whether it is a number. Whatever else comes is reckoned with as written.
'use strict';
function eased(x) { return x < 0.25 ? x * 3 : 0.5 + x * x; }
function bent(x, by) { const y = by > 0 ? x + by : x - by * 2; return y > 1 ? 2 - y : y; }
function tinted(light, warm, k) { const v = warm > light ? k * warm - light : k + light / 3; return v * v > light ? v - warm : warm * 0.25 + v; }
class Lamp {
  constructor(light, warm) { this.light = light; this.warm = warm; this.on = true; }
  part(k) { return this.on ? tinted(this.light, this.warm, k) : this.off(k); }
  off(k) { return k * this.light - eased(k); }
  glow(x) { return bent(eased(x), this.warm) * this.light; }
  dim(by) { this.light -= by; this.warm = this.warm > by ? this.warm - by / 2 : by; return this; }
  between(o, x) { return this.light * (1 - x) + o.light * x - bent(x, o.warm); }
}
function parts(lamps, k) { let sum = 0; for (let i = 0; i < lamps.length; i++) sum += lamps[i].part(k + i / 10); return sum; }
function glows(lamps, steps) { let sum = 0; for (let s = 0; s <= steps; s++) for (const lamp of lamps) sum += lamp.glow(s / steps); return sum; }
function ways(lamps, list) { let out = 0; for (let i = 1; i < lamps.length; i++) for (let j = 0; j < list.length; j++) out += lamps[i].between(lamps[i - 1], list[j]); return out; }
const curves = [eased, x => bent(x, 0.25), x => x, Math.sqrt, x => x ** 3], show = v => typeof v === 'number' ? (Object.is(v, -0) ? '-0' : v !== v ? 'NaN' : String(Math.round(v * 1e6) / 1e6)) : typeof v + ' ' + String(v), told = run => { try { return show(run()); } catch (error) { return error.constructor.name; } };
function curved(which, n) { let sum = 0; for (let i = 0; i < n; i++) sum += curves[(which + i) % curves.length](i / n); return sum; }
const lamps = () => [new Lamp(0.5, 0.25), new Lamp(1, 0), new Lamp(0.125, 2), new Lamp(3, -1)];
for (let k = 0; k < 150; k++) { const all = lamps(); all[k % 4].on = k % 3 > 0; parts(all, k / 40); glows(all, 6); ways(all, [0, 0.25, 1]); curved(k, 9); all[0].dim(k / 100); }
console.log(parts(lamps(), 0.1), glows(lamps(), 8), ways(lamps(), [0.2, 0.4]), curved(0, 10), curved(3, 4), parts(lamps().map(l => l.dim(0.5)), 0.9));
const odd = ['1', 'x', null, undefined, true, NaN, -0, Infinity, [2], {}, { valueOf: () => 0.75 }, 2n, Symbol('s'), new Date(5), 2 ** 31, -1e-7];
for (const v of odd) console.log(told(() => v), told(() => parts(lamps(), v)), told(() => glows([new Lamp(v, 0.5)], 3)), told(() => glows([new Lamp(0.5, v)], 3)), told(() => ways([new Lamp(1, v), new Lamp(v, 0.5)], [0.5, 0.75])), told(() => ways(lamps(), [v])), told(() => tinted(v, 0.5, 0.25)), told(() => eased(v)), told(() => bent(v, v)), told(() => new Lamp(v, 1).dim(v).light));
const mixed = [new Lamp(1, 1), { light: 2, warm: 3, part(k) { return k * 10; }, glow: x => x, between: () => 1 }, Object.create(new Lamp(0.5, 0.5)), new (class extends Lamp { off(k) { return super.off(k) + 100; } get on() { return false; } set on(v) { this.was = v; } })(1, 2)]; console.log(told(() => parts(mixed, 0.5)), told(() => glows(mixed, 2)), told(() => ways(mixed, [0.5])), mixed[3].was);
let order = ''; const slow = (name, v) => ({ valueOf() { order += name; return v; } }); console.log(told(() => tinted(slow('l', 1), slow('w', 2), slow('k', 0.1))), order); order = ''; console.log(told(() => bent(slow('x', 0.2), slow('b', -1))), order, told(() => parts([null], 1)), told(() => glows([{}], 1)), told(() => ways([new Lamp(1, 1), undefined], [1])));
Lamp.prototype.off = function (k) { return 'off' + k; }; const dark = lamps(); dark[1].on = 0; console.log(told(() => parts(dark, 0.5))); curves[2] = () => 'curve'; console.log(told(() => curved(0, 5))); curves[1] = null; console.log(told(() => curved(0, 5))); delete Lamp.prototype.part; console.log(told(() => parts(lamps(), 0)));
