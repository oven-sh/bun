class Box { constructor(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.v = v; } get() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return this.v; } static of(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return new Box(v); } }
class Lid extends Box { get() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return super.get() + 1; } }
module.exports = Box;
module.exports.Lid = Lid;
