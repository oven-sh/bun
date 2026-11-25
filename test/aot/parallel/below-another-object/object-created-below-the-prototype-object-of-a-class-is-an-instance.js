// `Object.create(C.prototype)` and `Object.setPrototypeOf({}, C.prototype)` lay objects below C.prototype that no `new C` has made: each is an instance of C, whatever its shape
// Under: --aot-testing=CheckProofsAtRunTime: LinkedLayout::onlyOwnObjectsStandBelowPrototype of C
class C { constructor() { this.x = 1; } }
function isC(value) { return value instanceof C; }
function deed(value) { return String(isC(value)); }
console.log(deed(new C()), deed({}));
let log = "";
for (let turn = 0; turn < 300; turn++) log = deed(turn & 1 ? new C() : { x: 1 });
console.log(log);
console.log(deed(Object.create(C.prototype)));
console.log(deed(Object.setPrototypeOf({ x: 1 }, C.prototype)));
console.log(deed(Object.create(Object.create(C.prototype))));
console.log(deed(Object.setPrototypeOf(new C(), null)));
console.log(deed(new C()), deed({}));
