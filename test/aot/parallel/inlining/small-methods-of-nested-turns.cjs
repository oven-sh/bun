'use strict';
// Small methods that nested turns call and that are copied into their callers. Between the turns they are replaced, wrapped, deleted, found on another object above, throw, and come back.
class Tape {
  constructor(cells) { this.cells = cells; this.at = 0; this.moves = 0; }
  read() { return this.at < this.cells.length ? this.cells[this.at] : -1; }
  step() { this.at++; this.moves++; return this; }
  isEnd() { return this.at >= this.cells.length; }
  isSmall(v) { return v >= 0 && v < 10; }
  run() { let n = 0; while (!this.isEnd() && this.isSmall(this.read())) { n = n * 2 + this.read(); this.step(); } return n; }
  skip() { while (!this.isEnd() && !this.isSmall(this.read())) this.step(); return this.at; }
}
function all(tape) { let s = 0, rounds = 0; for (tape.at = 0; !tape.isEnd() && rounds < 50; rounds++) { s = s * 5 + tape.run() | 0; s += tape.skip(); } return s + ':' + tape.moves + ':' + rounds; }
const cells = JSON.parse('[1,2,3,40,50,6,7,70,8,9,9,1000,-5,3,2,1,11,0]');
const say = f => { try { return String(f()); } catch (e) { return e.constructor.name + (e instanceof RangeError ? ' ' + e.message : ''); } };
const make = () => new Tape(cells.slice()), P = Tape.prototype, own = { ...Object.getOwnPropertyDescriptors(P) };
const back = () => Object.defineProperties(P, own);
for (let i = 0; i < 200; i++) all(make());
console.log('first', all(make()));
const changes = { replaced() { P.isSmall = v => v % 2 === 0; }, wrapped() { const f = P.read; let n = 0; P.read = function () { if (++n === 7) this.cells.push(5); return f.call(this); }; }, deleted() { delete P.step; }, throws() { P.isEnd = function () { if (this.at === 4) throw new RangeError('at four'); return this.at >= this.cells.length; }; }, getter() { Object.defineProperty(P, 'isSmall', { configurable: true, get() { return v => v < 100; } }); }, above() { delete P.skip; Object.setPrototypeOf(P, { skip() { this.at += 2; return -1; } }); }, text() { P.read = 'no function'; }, changes() { let n = 0; P.step = function () { if (++n === 3) P.isSmall = () => false; this.at++; return this; }; } };
for (const name of Object.keys(changes)) {
  changes[name](); console.log(name, say(() => all(make())), say(() => make().run()));
  back(); Object.setPrototypeOf(P, Object.prototype); console.log(name, 'back', all(make()));
}
const one = make(); one.isSmall = v => v < 60; console.log('own', say(() => all(one)), all(make()));
class Heir extends Tape { read() { return super.read() + 1; } } console.log('heir', say(() => all(new Heir(cells.slice()))));
