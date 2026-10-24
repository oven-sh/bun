// What a formatter and its neighbors show of the properties an object inherits. Nobody else reads them.
import { inspect, isDeepStrictEqual } from "node:util";
console.log(Object.create({ f1() {}, unit1: "p" }));
console.log(Bun.inspect(Object.create({ f2() {}, unit2: "p" })));
console.log(inspect(Object.create({ f3() {}, unit3: "p" })));
console.log(`${Bun.inspect({ __proto__: { unit4: "p" }, own: 1 })}`);
class Base5 { constructor() { this.unit5 = "p"; } method5() {} }
console.log(Object.create(new Base5()));
console.log(new Base5());
function Old6() {}
Old6.prototype.unit6 = "p";
console.log(new Old6());
function Old7() {}
Old7.prototype = { unit7: "p", nested7: { deep7: 1 } };
console.log(new Old7());
console.log(Object.create(Object.create({ unit8: "p" })));
console.log([Object.create({ unit9: "p" })], { holder: Object.create({ unit10: "p" }) });
console.log(Object.create({ [Symbol.for("nodejs.util.inspect.custom")]() { return "custom 11"; } }));
console.log(Object.create({ inner12: { [Symbol.for("nodejs.util.inspect.custom")]() { return "custom 12"; } } }));
console.log(Object.create({ get unit13() { return "from a getter"; } }));
console.log(Bun.deepEquals(Object.create({ unit14: "p" }), Object.create({ unit14: "q" })), Bun.deepEquals(Object.create({ unit15: "p" }), {}), isDeepStrictEqual(Object.create({ unit16: "p" }), Object.create({ unit16: "q" })));
console.log(Object.keys(structuredClone(Object.create({ unit17: "p" }))).length, JSON.stringify(Object.create({ unit18: "p" })));
{ let names = ""; for (const name in Object.create({ unit19: "p", f19() {} })) names += name + " "; console.log(names); }
console.log(Object.assign({}, Object.create({ unit20: "p" })), { ...Object.create({ unit21: "p" }) });
console.error(Object.create({ unit22: "p" }));
console.log("%o", Object.create({ unit23: "p" }));
console.log(String(new Error("message", { cause: Object.create({ unit24: "p" }) }).cause.unit24));
console.table([Object.create({ unit25: "p" })]);
function Old26() {}
Old26.prototype.method26 = function () {};
console.log(new Old26());
class Printed27 { method27() {} get accessor27() { return 1; } static fixed27 = 1; }
console.log(new Printed27(), Object.create(new Printed27()));
class Printed28 { method28() {} }
Printed28.prototype.added28 = { deep28: 1 };
console.log(new Printed28());
console.log(Object.create(Object.freeze({ unit29: "p", f29() {} })));
console.log(Object.create(new Map([[1, 2]])), Object.create([1, 2]), Object.create(function named30() {}));
