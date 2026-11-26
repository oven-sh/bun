class Base { constructor(n) { this.n = n; } m(z) { return z; } }
function mixed(Above) { return class extends Above { }; }
const Mixed = mixed(Base);
Mixed.prototype.m = function () { return 1; };
function finds(o, value) { for (const q in o) if (o[q] === value) return q; return "none"; }
console.log("mixed", finds(new Mixed(3), undefined), finds(new Mixed(3), 3));
