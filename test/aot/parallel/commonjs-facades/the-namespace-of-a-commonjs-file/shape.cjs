function Shape(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.n = n; }
Shape.unit = function () { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return new Shape(1); };
module.exports = Shape;
