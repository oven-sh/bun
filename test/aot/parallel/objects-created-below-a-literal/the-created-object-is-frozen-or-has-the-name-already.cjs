'use strict';
const said = [];
const q = +(process.argv[2] ?? 3);
const attempt = (f) => { try { return f(); } catch (error) { return error.constructor.name; } };
const answer = {
  get body() { return this._body; },
  set body(value) { this._body = value; this._set = (this._set | 0) + 1; if (value === null) this._empty = true; },
  mark(n) { this._mark = n; return this; },
  sum() { return (this._mark | 0) + (this._set | 0); },
};
class App { constructor() { this.answer = Object.create(answer); } make() { const made = Object.create(this.answer); made.app = this; return made; } }
const app = new App();
const cold = Object.freeze(app.make()); const own = app.make(); Object.defineProperty(own, '_body', { get() { return 'own'; }, set(v) { said.push('own setter ' + v); } });
said.push(attempt(() => { cold.body = q; return 'stored'; }), cold._body); own.body = q; said.push(own.body, own._set);
console.log(said.join(' | '));
