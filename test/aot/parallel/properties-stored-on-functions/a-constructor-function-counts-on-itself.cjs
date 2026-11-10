// COUNT: operation:operationAOTPutByIdSloppy <= 8
function Own() { this.id = Own.count; Own.count += 1; } Own.count = 1;
var space = {}; space.Kept = function () { this.id = space.Kept.count; space.Kept.count += 1; }; space.Kept.count = 1;
function Heard() { this.id = Heard.make(); } Heard.make = function () { return 1; };
function ids(n) { var s = 0; for (var i = 0; i < n; i++) s += new Own().id + new space.Kept().id * 3 + new Heard().id; return s; }
console.log(ids(200), Own.count, space.Kept.count);
Heard.make = function () { return 5; };
console.log(ids(3), Object.keys(Own).join(), Object.getOwnPropertyDescriptor(Own, "count").writable);
Object.defineProperty(Own, "count", { value: 7, writable: false });
console.log(ids(2), Own.count);
function Below() {} Object.setPrototypeOf(Below, Own);
console.log(Below.count, (Below.count = 9, Below.count), Own.count, Object.keys(Below).join());
