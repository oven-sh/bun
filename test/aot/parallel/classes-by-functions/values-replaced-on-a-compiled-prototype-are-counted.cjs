// The prototype of Heir is an instance of Base. One store replaces a value that lies beside its fields a thousand times: each of these stores is told, and counted.
// COUNT: counter:ValuesReplacedOnCompiledPrototypes >= 1000
// COUNT: counter:ValuesReplacedOnCompiledPrototypes <= 1100
"use strict";
function Base(a) { this.a = a; }
function Heir(a) { this.a = a; }
Heir.prototype = new Base(0);
Heir.prototype.constructor = Heir;
Heir.prototype.calls = 0;
const turns = Number(process.argv[2] ?? 1000);
function count(holder) { holder.calls = holder.calls + 1; }
let sum = 0;
for (let i = 0; i < turns; i++) { count(Heir.prototype); sum = (sum + new Heir(i & 3).calls) | 0; }
console.log(sum, Heir.prototype.calls);
