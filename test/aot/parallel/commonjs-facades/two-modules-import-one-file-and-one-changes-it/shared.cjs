function Shared(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.v = v; }
Shared.prototype.read = function () { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return this.v; };
module.exports = Shared;
