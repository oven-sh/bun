// Fields without a written type are seen to hold instances of a class of the file whose methods bear the names of a Map's: what was seen says more than what a checker would find, and whatever else is stored there later is asked as written.
'use strict';
class Drawer {
  constructor(entries) { this.labels = new Map(); this.opened = 0; if (entries) for (const [label, thing] of entries) this.set(label, thing); }
  spell(label) { return String(label).replace(/[\s_-]+/g, '').normalize(); }
  has(label) { this.opened++; return this.labels.has(this.spell(label)); }
  get(label) { const found = this.labels.get(this.spell(label)); return found === undefined ? null : found; }
  set(label, thing) { this.labels.set(this.spell(label), thing); return this; }
  delete(label) { return this.labels.delete(this.spell(label)); }
  get size() { return this.labels.size; }
}
function Desk() { this.drawer = new Drawer(); this.spare = null; this.missed = []; }
Desk.prototype.put = function (label, thing) { if (this.drawer.has(label)) this.missed.push(label); else this.drawer.set(label, thing); return this; };
Desk.prototype.find = function (label) { if (!this.drawer.has(label)) return this.spare !== null && this.spare.has(label) ? this.spare.get(label) : 'none'; return this.drawer.get(label); };
Desk.prototype.sum = function (labels) { let sum = 0; for (let i = 0; i < labels.length; i++) { const v = this.find(labels[i]); sum += typeof v === 'number' ? v : 0.5; } return sum; };
Desk.prototype.count = function () { return this.drawer.size + (this.spare ? this.spare.size : 0) + '/' + this.drawer.opened + '/' + this.missed.join('+'); };
const labels = ['pen', ' p e n', 'nib', 'n_i_b', 'ink-pot', 'inkpot', 'cap'], told = run => { try { return String(run()); } catch (error) { return error.constructor.name; } };
for (let k = 0; k < 120; k++) { const d = new Desk(); for (let i = 0; i < labels.length; i++) d.put(labels[(i + k) % labels.length], i * k); d.sum(labels); d.count(); if (k % 9 === 0) d.spare = new Drawer([['cap', 1]]); d.find('lid'); }
const desk = new Desk(); desk.put('pen', 1).put('P e n', 2).put('p-e-n', 3).put('nib', 2.5); console.log(desk.sum(labels), desk.count(), desk.find('pen'), desk.find('cap')); desk.spare = new Drawer([['cap', 4], [5, 'five'], [null, 'nothing'], ['c a p', 6]]); console.log(desk.sum(labels), desk.count(), desk.find(5), desk.find('null'), desk.find(undefined));
const others = { map: new Map([['pen', 7], ['nib', 8]]), weak: new WeakMap(), set: new Set(['pen', 'cap']), own: { has: l => l.length > 2, get: l => l.length, set() { return this; }, size: 3 }, above: Object.create(new Drawer([['pen', 9]])), heir: new (class extends Drawer { get(l) { return super.get(l) + 100; } spell(l) { return l[0]; } })([['pen', 1], ['cap', 2]]), list: ['pen'], text: 'pen', number: 4, none: undefined, proxy: new Proxy(new Drawer([['nib', 3]]), {}), part: { has: 1 } };
for (const name of Object.keys(others)) { const d = new Desk(); d.drawer = others[name]; console.log(name, told(() => d.sum(labels)), told(() => d.find('pen')), told(() => d.put('lid', 1).find('lid')), told(() => d.count()), told(() => { const e = new Desk(); e.spare = others[name]; return e.sum(labels) + ' ' + e.count(); })); }
desk.drawer.labels = new Map([['nib', 'late']]); console.log(desk.find('nib'), desk.find('pen')); desk.drawer.has = () => true; console.log(desk.find('lid'), desk.put('lid', 1).missed.length); delete desk.drawer.has; Drawer.prototype.get = function (l) { return 'new ' + l; }; console.log(desk.find('nib'), desk.sum(['nib', 'cap'])); Drawer.prototype.has = null; console.log(told(() => desk.find('nib')), told(() => new Desk().put('a', 1)));
Object.defineProperty(Desk.prototype, 'drawer', { get() { return others.map; }, set(v) { this.kept = v; }, configurable: true }); const late = new Desk(); console.log(told(() => late.find('pen')), late.kept instanceof Drawer, told(() => late.count()), Object.keys(late).join());
