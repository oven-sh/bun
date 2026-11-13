// An accessor that the file lays on F.prototype is expected there, also where a helper that is passed F.prototype lays another one.
function Temp(c) { this._c = c; }
Object.defineProperty(Temp.prototype, "f", { get: function () { return this._c * 2 + 32; }, set: function (v) { this._c = (v - 32) / 2; }, enumerable: true, configurable: true });
function run(count) { let total = 0; for (let i = 0; i < count; i++) { const t = new Temp(i & 7); t.f = t.f + 2; total += t.f; } return total; }
function lay(holder, get, set) { Object.defineProperty(holder, "f", { get: function () { return 1; }, set: function () { }, configurable: true }); }
function layHalf(holder) { Object.defineProperty(holder, "f", { get: function () { return 7; }, configurable: true }); }
function layValue(holder) { Object.defineProperty(holder, "f", { value: 5, writable: true, configurable: true }); }
console.log(run(10));
lay({});
console.log(run(10));
lay(Temp.prototype);
console.log(run(10));
layHalf(Temp.prototype);
console.log(run(10));
layValue(Temp.prototype);
console.log(run(10));
delete Temp.prototype.f;
console.log(run(10), Object.keys(new Temp(1)).join());
// The helper comes first.
function Other(c) { this._c = c; }
lay(Other.prototype);
function runOther(count) { let total = 0; for (let i = 0; i < count; i++) { const t = new Other(i & 7); t.f = t.f + 2; total += t.f; } return total; }
console.log(runOther(10));
Object.defineProperty(Other.prototype, "f", { get: function () { return this._c; }, set: function (v) { this._c = v * 3; }, configurable: true });
console.log(runOther(10));
// Two helpers.
function Third(c) { this._c = c; }
lay(Third.prototype);
function runThird(count) { let total = 0; for (let i = 0; i < count; i++) { const t = new Third(i & 7); t.f = 2; total += t.f; } return total; }
console.log(runThird(5));
layHalf(Third.prototype);
console.log(runThird(5));
class Heir extends Temp { }
lay(Temp.prototype);
console.log(new Heir(3).f, Object.getOwnPropertyNames(Heir.prototype).join());
/* Output:
398
398
10
70
70
NaN _c
10
147
5
35
1 constructor
*/
