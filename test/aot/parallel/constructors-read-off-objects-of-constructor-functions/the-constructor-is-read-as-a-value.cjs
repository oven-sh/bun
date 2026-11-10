const turns = +process.argv[2] || 200;
const name = process.argv[3] || "constructor";
function Other() {}
function P(x) { this.x = x; }
P.prototype.maker = function () { return this.constructor; };
const p = new P(1);
let same = 0, names = "";
for (let i = 0; i < turns; i++) { if (i === turns - 3) P.prototype[name] = Other; const maker = p.maker(); if (maker === P) same++; if (i >= turns - 5) names += maker.name; }
console.log(same, names);
