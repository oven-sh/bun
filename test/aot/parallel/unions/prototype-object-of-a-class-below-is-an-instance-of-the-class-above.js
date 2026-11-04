// `D.prototype instanceof C`: the prototype object of a class that is written below C stands below C.prototype, and no `new C` has made it
// Under: --aot-testing=CheckProofsAtRunTime: LinkedLayout::onlyOwnObjectsStandBelowPrototype of C
class C { constructor() { this.x = 1; } }
class D extends C { constructor() { super(); this.y = 2; } }
function isC(value) { return value instanceof C; }
function isD(value) { return value instanceof D; }
function deed(value) { return String(isC(value)) + " " + String(isD(value)); }
console.log(deed(new C()), deed(new D()));
let log = "";
for (let turn = 0; turn < 300; turn++) log = deed(turn & 1 ? new C() : new D());
console.log(log);
console.log(deed(D.prototype), deed(C.prototype), deed(Object.prototype));
console.log(deed(new C()), deed(new D()));
