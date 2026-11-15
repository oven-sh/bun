const turns = +process.argv[2] || 200;
function Base(x) { this.x = x; this.kind = "base"; }
Base.prototype.next = function () { return new this.constructor(this.x + 1); };
function P(x) { this.x = x; this.kind = "p"; }
P.prototype = Object.create(Base.prototype);
P.prototype.next = function () { return new this.constructor(this.x + 1); };
let bases = 0, ps = 0, sum = 0;
for (let i = 0; i < turns; i++) { const made = new P(i).next(); if (made.kind === "base") bases++; else ps++; sum += made.x; }
console.log(bases, ps, sum, new P(1).next() instanceof P, new P(1).constructor === Base);
