// Nobody reads the value of the field "late". Each row asks in one way whether the object has it, of an instance of a class of its own and of a literal of its own, so no other row keeps the field alive.
const key = ["la", "te"].join("");
class Made1 { constructor() { this.late = 1; } }
class Field1 { late = 1; }
console.log("Object.hasOwn, computed key |", Object.hasOwn(new Made1(), key), Object.hasOwn(new Field1(), key), Object.hasOwn({ late: 1 }, key));
class Made2 { constructor() { this.late = 2; } }
class Field2 { late = 2; }
console.log("hasOwnProperty, computed key |", new Made2().hasOwnProperty(key), new Field2().hasOwnProperty(key), ({ late: 2 }).hasOwnProperty(key));
class Made3 { constructor() { this.late = 3; } }
class Field3 { late = 3; }
console.log("hasOwnProperty.call, computed key |", Object.prototype.hasOwnProperty.call(new Made3(), key), Object.prototype.hasOwnProperty.call(new Field3(), key), Object.prototype.hasOwnProperty.call({ late: 3 }, key));
class Made4 { constructor() { this.late = 4; } }
class Field4 { late = 4; }
console.log("propertyIsEnumerable, computed key |", new Made4().propertyIsEnumerable(key), new Field4().propertyIsEnumerable(key), ({ late: 4 }).propertyIsEnumerable(key));
class Made5 { constructor() { this.late = 5; } }
class Field5 { late = 5; }
console.log("in, computed key |", key in new Made5(), key in new Field5(), key in { late: 5 });
class Made6 { constructor() { this.late = 6; } }
class Field6 { late = 6; }
console.log("Reflect.has, computed key |", Reflect.has(new Made6(), key), Reflect.has(new Field6(), key), Reflect.has({ late: 6 }, key));
class Made7 { constructor() { this.late = 7; } }
class Field7 { late = 7; }
console.log("Object.getOwnPropertyDescriptor, computed key |", Object.getOwnPropertyDescriptor(new Made7(), key) !== undefined, Object.getOwnPropertyDescriptor(new Field7(), key) !== undefined, Object.getOwnPropertyDescriptor({ late: 7 }, key) !== undefined);
class Made8 { constructor() { this.late = 8; } }
class Field8 { late = 8; }
console.log("Object.hasOwn |", Object.hasOwn(new Made8(), "late"), Object.hasOwn(new Field8(), "late"), Object.hasOwn({ late: 8 }, "late"));
class Made9 { constructor() { this.late = 9; } }
class Field9 { late = 9; }
console.log("hasOwnProperty |", new Made9().hasOwnProperty("late"), new Field9().hasOwnProperty("late"), ({ late: 9 }).hasOwnProperty("late"));
class Made10 { constructor() { this.late = 10; } }
class Field10 { late = 10; }
console.log("propertyIsEnumerable |", new Made10().propertyIsEnumerable("late"), new Field10().propertyIsEnumerable("late"), ({ late: 10 }).propertyIsEnumerable("late"));
class Made11 { constructor() { this.late = 11; } }
class Field11 { late = 11; }
console.log("in |", "late" in new Made11(), "late" in new Field11(), "late" in { late: 11 });
class Made12 { constructor() { this.late = 12; } }
class Field12 { late = 12; }
console.log("Reflect.has |", Reflect.has(new Made12(), "late"), Reflect.has(new Field12(), "late"), Reflect.has({ late: 12 }, "late"));
class Made13 { constructor() { this.late = 13; } }
class Field13 { late = 13; }
console.log("Reflect.getOwnPropertyDescriptor |", Reflect.getOwnPropertyDescriptor(new Made13(), "late") !== undefined, Reflect.getOwnPropertyDescriptor(new Field13(), "late") !== undefined, Reflect.getOwnPropertyDescriptor({ late: 13 }, "late") !== undefined);
class Made14 { constructor() { this.late = 14; } }
class Field14 { late = 14; }
console.log("__lookupGetter__ |", typeof new Made14().__lookupGetter__("late"), typeof new Field14().__lookupGetter__("late"), typeof { late: 14 }.__lookupGetter__("late"));
class Made15 { constructor() { this.late = 15; } }
class Field15 { late = 15; }
console.log("Object.keys |", Object.keys(new Made15()).length, Object.keys(new Field15()).length, Object.keys({ late: 15 }).length);
class Made16 { constructor() { this.late = 16; } }
class Field16 { late = 16; }
console.log("Reflect.ownKeys |", Reflect.ownKeys(new Made16()).length, Reflect.ownKeys(new Field16()).length, Reflect.ownKeys({ late: 16 }).length);
class Made17 { constructor() { this.late = 17; } }
class Field17 { late = 17; }
console.log("Object.getOwnPropertyNames |", Object.getOwnPropertyNames(new Made17()).length, Object.getOwnPropertyNames(new Field17()).length, Object.getOwnPropertyNames({ late: 17 }).length);
class Made18 { constructor() { this.late = 18; } }
class Field18 { late = 18; }
console.log("Object.entries |", Object.entries(new Made18()).length, Object.entries(new Field18()).length, Object.entries({ late: 18 }).length);
class Made19 { constructor() { this.late = 19; } }
class Field19 { late = 19; }
console.log("Object.values |", Object.values(new Made19()).length, Object.values(new Field19()).length, Object.values({ late: 19 }).length);
class Made20 { constructor() { this.late = 20; } }
class Field20 { late = 20; }
console.log("JSON.stringify |", JSON.stringify(new Made20()), JSON.stringify(new Field20()), JSON.stringify({ late: 20 }));
class Made21 { constructor() { this.late = 21; } }
class Field21 { late = 21; }
console.log("spread |", Object.keys({ ...new Made21() }).length, Object.keys({ ...new Field21() }).length, Object.keys({ ...{ late: 21 } }).length);
class Made22 { constructor() { this.late = 22; } }
class Field22 { late = 22; }
console.log("Object.assign |", Object.keys(Object.assign({}, new Made22())).length, Object.keys(Object.assign({}, new Field22())).length, Object.keys(Object.assign({}, { late: 22 })).length);
class Made23 { constructor() { this.late = 23; } }
class Field23 { late = 23; }
console.log("for-in |", (() => { let count = 0; for (const name in new Made23()) count++; return count; })(), (() => { let count = 0; for (const name in new Field23()) count++; return count; })(), (() => { let count = 0; for (const name in { late: 23 }) count++; return count; })());
class Made24 { constructor() { this.late = 24; } }
class Field24 { late = 24; }
console.log("Object.isFrozen of a closed object |", Object.isFrozen(Object.preventExtensions(new Made24())), Object.isFrozen(Object.preventExtensions(new Field24())), Object.isFrozen(Object.preventExtensions({ late: 24 })));
class Made25 { constructor() { this.late = 25; } }
class Field25 { late = 25; }
console.log("Object.isSealed of a closed object |", Object.isSealed(Object.preventExtensions(new Made25())), Object.isSealed(Object.preventExtensions(new Field25())), Object.isSealed(Object.preventExtensions({ late: 25 })));
class Made26 { constructor() { this.late = 26; } }
class Field26 { late = 26; }
console.log("Object.isFrozen of a sealed object |", Object.isFrozen(Object.seal(new Made26())), Object.isFrozen(Object.seal(new Field26())), Object.isFrozen(Object.seal({ late: 26 })));
class Made27 { constructor() { this.late = 27; } }
class Field27 { late = 27; }
console.log("structuredClone |", Object.keys(structuredClone(new Made27())).length, Object.keys(structuredClone(new Field27())).length, Object.keys(structuredClone({ late: 27 })).length);
class Made28 { constructor() { this.late = 28; } }
class Field28 { late = 28; }
console.log("delete |", delete new Made28().late, delete new Field28().late, delete { late: 28 }.late);
class Made29 { constructor() { this.late = 29; } }
class Field29 { late = 29; }
console.log("a definition that keeps the value |", Object.getOwnPropertyNames(Object.defineProperty(new Made29(), "late", { enumerable: false })).length, Object.getOwnPropertyNames(Object.defineProperty(new Field29(), "late", { enumerable: false })).length, Object.getOwnPropertyNames(Object.defineProperty({ late: 29 }, "late", { enumerable: false })).length);
