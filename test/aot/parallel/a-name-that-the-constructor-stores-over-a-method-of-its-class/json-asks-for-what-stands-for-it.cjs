"use strict";
class Amount { constructor(n) { this.n = n; this.toJSON = () => "own" + this.n; } toJSON() { return "above" + this.n; } }
const turns = +(process.argv[2] ?? 50); let length = 0;
for (let i = 0; i < turns; i++) length += JSON.stringify(new Amount(i)).length + JSON.stringify([new Amount(i)]).length;
console.log(length, JSON.stringify(new Amount(7)), JSON.stringify({ a: new Amount(8) }));
