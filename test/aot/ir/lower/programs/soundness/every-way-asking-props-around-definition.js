// RUN: lower
// OPTIONS: builtin-modules

// Each row asks an object for the property "late" in one way, once before the property is defined and once behind the definition.
const lateKey = ["la", "te"].join("");
class Named1 { static before = "late" in Named1; static late = 1; static behind = "late" in Named1; }
console.log("static field, class by name |", "in", "|", Named1.before, Named1.behind);
class This1 { static before = "late" in this; static late = 1; static behind = "late" in this; }
console.log("static field, this |", "in", "|", This1.before, This1.behind);
class Block1 { static before; static behind; static { this.before = "late" in Block1; } static late = 1; static { this.behind = "late" in Block1; } }
console.log("static block |", "in", "|", Block1.before, Block1.behind);
class Field1 { before = "late" in this; late = 1; behind = "late" in this; }
{ const made = new Field1(); console.log("instance field |", "in", "|", made.before, made.behind); }
class Made1 { constructor() { this.before = "late" in this; this.late = 1; this.behind = "late" in this; } }
{ const made = new Made1(); console.log("store in the constructor |", "in", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = "late" in object; object.late = 1; console.log("store behind a literal |", "in", "|", before, "late" in object); }
function fill1(object) { const before = "late" in object; object.late = 1; return [before, "late" in object].join(" "); }
console.log("store in a callee |", "in", "|", fill1({ first: 0 }));
class Named2 { static before = Object.hasOwn(Named2, "late"); static late = 1; static behind = Object.hasOwn(Named2, "late"); }
console.log("static field, class by name |", "Object.hasOwn", "|", Named2.before, Named2.behind);
class This2 { static before = Object.hasOwn(this, "late"); static late = 1; static behind = Object.hasOwn(this, "late"); }
console.log("static field, this |", "Object.hasOwn", "|", This2.before, This2.behind);
class Block2 { static before; static behind; static { this.before = Object.hasOwn(Block2, "late"); } static late = 1; static { this.behind = Object.hasOwn(Block2, "late"); } }
console.log("static block |", "Object.hasOwn", "|", Block2.before, Block2.behind);
class Field2 { before = Object.hasOwn(this, "late"); late = 1; behind = Object.hasOwn(this, "late"); }
{ const made = new Field2(); console.log("instance field |", "Object.hasOwn", "|", made.before, made.behind); }
class Made2 { constructor() { this.before = Object.hasOwn(this, "late"); this.late = 1; this.behind = Object.hasOwn(this, "late"); } }
{ const made = new Made2(); console.log("store in the constructor |", "Object.hasOwn", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = Object.hasOwn(object, "late"); object.late = 1; console.log("store behind a literal |", "Object.hasOwn", "|", before, Object.hasOwn(object, "late")); }
function fill2(object) { const before = Object.hasOwn(object, "late"); object.late = 1; return [before, Object.hasOwn(object, "late")].join(" "); }
console.log("store in a callee |", "Object.hasOwn", "|", fill2({ first: 0 }));
class Named3 { static before = Named3.hasOwnProperty("late"); static late = 1; static behind = Named3.hasOwnProperty("late"); }
console.log("static field, class by name |", "hasOwnProperty", "|", Named3.before, Named3.behind);
class This3 { static before = this.hasOwnProperty("late"); static late = 1; static behind = this.hasOwnProperty("late"); }
console.log("static field, this |", "hasOwnProperty", "|", This3.before, This3.behind);
class Block3 { static before; static behind; static { this.before = Block3.hasOwnProperty("late"); } static late = 1; static { this.behind = Block3.hasOwnProperty("late"); } }
console.log("static block |", "hasOwnProperty", "|", Block3.before, Block3.behind);
class Field3 { before = this.hasOwnProperty("late"); late = 1; behind = this.hasOwnProperty("late"); }
{ const made = new Field3(); console.log("instance field |", "hasOwnProperty", "|", made.before, made.behind); }
class Made3 { constructor() { this.before = this.hasOwnProperty("late"); this.late = 1; this.behind = this.hasOwnProperty("late"); } }
{ const made = new Made3(); console.log("store in the constructor |", "hasOwnProperty", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = object.hasOwnProperty("late"); object.late = 1; console.log("store behind a literal |", "hasOwnProperty", "|", before, object.hasOwnProperty("late")); }
function fill3(object) { const before = object.hasOwnProperty("late"); object.late = 1; return [before, object.hasOwnProperty("late")].join(" "); }
console.log("store in a callee |", "hasOwnProperty", "|", fill3({ first: 0 }));
class Named4 { static before = Object.prototype.hasOwnProperty.call(Named4, "late"); static late = 1; static behind = Object.prototype.hasOwnProperty.call(Named4, "late"); }
console.log("static field, class by name |", "hasOwnProperty.call", "|", Named4.before, Named4.behind);
class This4 { static before = Object.prototype.hasOwnProperty.call(this, "late"); static late = 1; static behind = Object.prototype.hasOwnProperty.call(this, "late"); }
console.log("static field, this |", "hasOwnProperty.call", "|", This4.before, This4.behind);
class Block4 { static before; static behind; static { this.before = Object.prototype.hasOwnProperty.call(Block4, "late"); } static late = 1; static { this.behind = Object.prototype.hasOwnProperty.call(Block4, "late"); } }
console.log("static block |", "hasOwnProperty.call", "|", Block4.before, Block4.behind);
class Field4 { before = Object.prototype.hasOwnProperty.call(this, "late"); late = 1; behind = Object.prototype.hasOwnProperty.call(this, "late"); }
{ const made = new Field4(); console.log("instance field |", "hasOwnProperty.call", "|", made.before, made.behind); }
class Made4 { constructor() { this.before = Object.prototype.hasOwnProperty.call(this, "late"); this.late = 1; this.behind = Object.prototype.hasOwnProperty.call(this, "late"); } }
{ const made = new Made4(); console.log("store in the constructor |", "hasOwnProperty.call", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = Object.prototype.hasOwnProperty.call(object, "late"); object.late = 1; console.log("store behind a literal |", "hasOwnProperty.call", "|", before, Object.prototype.hasOwnProperty.call(object, "late")); }
function fill4(object) { const before = Object.prototype.hasOwnProperty.call(object, "late"); object.late = 1; return [before, Object.prototype.hasOwnProperty.call(object, "late")].join(" "); }
console.log("store in a callee |", "hasOwnProperty.call", "|", fill4({ first: 0 }));
class Named5 { static before = Named5.propertyIsEnumerable("late"); static late = 1; static behind = Named5.propertyIsEnumerable("late"); }
console.log("static field, class by name |", "propertyIsEnumerable", "|", Named5.before, Named5.behind);
class This5 { static before = this.propertyIsEnumerable("late"); static late = 1; static behind = this.propertyIsEnumerable("late"); }
console.log("static field, this |", "propertyIsEnumerable", "|", This5.before, This5.behind);
class Block5 { static before; static behind; static { this.before = Block5.propertyIsEnumerable("late"); } static late = 1; static { this.behind = Block5.propertyIsEnumerable("late"); } }
console.log("static block |", "propertyIsEnumerable", "|", Block5.before, Block5.behind);
class Field5 { before = this.propertyIsEnumerable("late"); late = 1; behind = this.propertyIsEnumerable("late"); }
{ const made = new Field5(); console.log("instance field |", "propertyIsEnumerable", "|", made.before, made.behind); }
class Made5 { constructor() { this.before = this.propertyIsEnumerable("late"); this.late = 1; this.behind = this.propertyIsEnumerable("late"); } }
{ const made = new Made5(); console.log("store in the constructor |", "propertyIsEnumerable", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = object.propertyIsEnumerable("late"); object.late = 1; console.log("store behind a literal |", "propertyIsEnumerable", "|", before, object.propertyIsEnumerable("late")); }
function fill5(object) { const before = object.propertyIsEnumerable("late"); object.late = 1; return [before, object.propertyIsEnumerable("late")].join(" "); }
console.log("store in a callee |", "propertyIsEnumerable", "|", fill5({ first: 0 }));
class Named6 { static before = Reflect.has(Named6, "late"); static late = 1; static behind = Reflect.has(Named6, "late"); }
console.log("static field, class by name |", "Reflect.has", "|", Named6.before, Named6.behind);
class This6 { static before = Reflect.has(this, "late"); static late = 1; static behind = Reflect.has(this, "late"); }
console.log("static field, this |", "Reflect.has", "|", This6.before, This6.behind);
class Block6 { static before; static behind; static { this.before = Reflect.has(Block6, "late"); } static late = 1; static { this.behind = Reflect.has(Block6, "late"); } }
console.log("static block |", "Reflect.has", "|", Block6.before, Block6.behind);
class Field6 { before = Reflect.has(this, "late"); late = 1; behind = Reflect.has(this, "late"); }
{ const made = new Field6(); console.log("instance field |", "Reflect.has", "|", made.before, made.behind); }
class Made6 { constructor() { this.before = Reflect.has(this, "late"); this.late = 1; this.behind = Reflect.has(this, "late"); } }
{ const made = new Made6(); console.log("store in the constructor |", "Reflect.has", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = Reflect.has(object, "late"); object.late = 1; console.log("store behind a literal |", "Reflect.has", "|", before, Reflect.has(object, "late")); }
function fill6(object) { const before = Reflect.has(object, "late"); object.late = 1; return [before, Reflect.has(object, "late")].join(" "); }
console.log("store in a callee |", "Reflect.has", "|", fill6({ first: 0 }));
class Named7 { static before = Object.keys(Named7).includes("late"); static late = 1; static behind = Object.keys(Named7).includes("late"); }
console.log("static field, class by name |", "Object.keys", "|", Named7.before, Named7.behind);
class This7 { static before = Object.keys(this).includes("late"); static late = 1; static behind = Object.keys(this).includes("late"); }
console.log("static field, this |", "Object.keys", "|", This7.before, This7.behind);
class Block7 { static before; static behind; static { this.before = Object.keys(Block7).includes("late"); } static late = 1; static { this.behind = Object.keys(Block7).includes("late"); } }
console.log("static block |", "Object.keys", "|", Block7.before, Block7.behind);
class Field7 { before = Object.keys(this).includes("late"); late = 1; behind = Object.keys(this).includes("late"); }
{ const made = new Field7(); console.log("instance field |", "Object.keys", "|", made.before, made.behind); }
class Made7 { constructor() { this.before = Object.keys(this).includes("late"); this.late = 1; this.behind = Object.keys(this).includes("late"); } }
{ const made = new Made7(); console.log("store in the constructor |", "Object.keys", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = Object.keys(object).includes("late"); object.late = 1; console.log("store behind a literal |", "Object.keys", "|", before, Object.keys(object).includes("late")); }
function fill7(object) { const before = Object.keys(object).includes("late"); object.late = 1; return [before, Object.keys(object).includes("late")].join(" "); }
console.log("store in a callee |", "Object.keys", "|", fill7({ first: 0 }));
class Named8 { static before = Object.getOwnPropertyNames(Named8).includes("late"); static late = 1; static behind = Object.getOwnPropertyNames(Named8).includes("late"); }
console.log("static field, class by name |", "Object.getOwnPropertyNames", "|", Named8.before, Named8.behind);
class This8 { static before = Object.getOwnPropertyNames(this).includes("late"); static late = 1; static behind = Object.getOwnPropertyNames(this).includes("late"); }
console.log("static field, this |", "Object.getOwnPropertyNames", "|", This8.before, This8.behind);
class Block8 { static before; static behind; static { this.before = Object.getOwnPropertyNames(Block8).includes("late"); } static late = 1; static { this.behind = Object.getOwnPropertyNames(Block8).includes("late"); } }
console.log("static block |", "Object.getOwnPropertyNames", "|", Block8.before, Block8.behind);
class Field8 { before = Object.getOwnPropertyNames(this).includes("late"); late = 1; behind = Object.getOwnPropertyNames(this).includes("late"); }
{ const made = new Field8(); console.log("instance field |", "Object.getOwnPropertyNames", "|", made.before, made.behind); }
class Made8 { constructor() { this.before = Object.getOwnPropertyNames(this).includes("late"); this.late = 1; this.behind = Object.getOwnPropertyNames(this).includes("late"); } }
{ const made = new Made8(); console.log("store in the constructor |", "Object.getOwnPropertyNames", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = Object.getOwnPropertyNames(object).includes("late"); object.late = 1; console.log("store behind a literal |", "Object.getOwnPropertyNames", "|", before, Object.getOwnPropertyNames(object).includes("late")); }
function fill8(object) { const before = Object.getOwnPropertyNames(object).includes("late"); object.late = 1; return [before, Object.getOwnPropertyNames(object).includes("late")].join(" "); }
console.log("store in a callee |", "Object.getOwnPropertyNames", "|", fill8({ first: 0 }));
class Named9 { static before = Reflect.ownKeys(Named9).includes("late"); static late = 1; static behind = Reflect.ownKeys(Named9).includes("late"); }
console.log("static field, class by name |", "Reflect.ownKeys", "|", Named9.before, Named9.behind);
class This9 { static before = Reflect.ownKeys(this).includes("late"); static late = 1; static behind = Reflect.ownKeys(this).includes("late"); }
console.log("static field, this |", "Reflect.ownKeys", "|", This9.before, This9.behind);
class Block9 { static before; static behind; static { this.before = Reflect.ownKeys(Block9).includes("late"); } static late = 1; static { this.behind = Reflect.ownKeys(Block9).includes("late"); } }
console.log("static block |", "Reflect.ownKeys", "|", Block9.before, Block9.behind);
class Field9 { before = Reflect.ownKeys(this).includes("late"); late = 1; behind = Reflect.ownKeys(this).includes("late"); }
{ const made = new Field9(); console.log("instance field |", "Reflect.ownKeys", "|", made.before, made.behind); }
class Made9 { constructor() { this.before = Reflect.ownKeys(this).includes("late"); this.late = 1; this.behind = Reflect.ownKeys(this).includes("late"); } }
{ const made = new Made9(); console.log("store in the constructor |", "Reflect.ownKeys", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = Reflect.ownKeys(object).includes("late"); object.late = 1; console.log("store behind a literal |", "Reflect.ownKeys", "|", before, Reflect.ownKeys(object).includes("late")); }
function fill9(object) { const before = Reflect.ownKeys(object).includes("late"); object.late = 1; return [before, Reflect.ownKeys(object).includes("late")].join(" "); }
console.log("store in a callee |", "Reflect.ownKeys", "|", fill9({ first: 0 }));
class Named10 { static before = Object.getOwnPropertyDescriptor(Named10, "late") !== undefined; static late = 1; static behind = Object.getOwnPropertyDescriptor(Named10, "late") !== undefined; }
console.log("static field, class by name |", "Object.getOwnPropertyDescriptor", "|", Named10.before, Named10.behind);
class This10 { static before = Object.getOwnPropertyDescriptor(this, "late") !== undefined; static late = 1; static behind = Object.getOwnPropertyDescriptor(this, "late") !== undefined; }
console.log("static field, this |", "Object.getOwnPropertyDescriptor", "|", This10.before, This10.behind);
class Block10 { static before; static behind; static { this.before = Object.getOwnPropertyDescriptor(Block10, "late") !== undefined; } static late = 1; static { this.behind = Object.getOwnPropertyDescriptor(Block10, "late") !== undefined; } }
console.log("static block |", "Object.getOwnPropertyDescriptor", "|", Block10.before, Block10.behind);
class Field10 { before = Object.getOwnPropertyDescriptor(this, "late") !== undefined; late = 1; behind = Object.getOwnPropertyDescriptor(this, "late") !== undefined; }
{ const made = new Field10(); console.log("instance field |", "Object.getOwnPropertyDescriptor", "|", made.before, made.behind); }
class Made10 { constructor() { this.before = Object.getOwnPropertyDescriptor(this, "late") !== undefined; this.late = 1; this.behind = Object.getOwnPropertyDescriptor(this, "late") !== undefined; } }
{ const made = new Made10(); console.log("store in the constructor |", "Object.getOwnPropertyDescriptor", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = Object.getOwnPropertyDescriptor(object, "late") !== undefined; object.late = 1; console.log("store behind a literal |", "Object.getOwnPropertyDescriptor", "|", before, Object.getOwnPropertyDescriptor(object, "late") !== undefined); }
function fill10(object) { const before = Object.getOwnPropertyDescriptor(object, "late") !== undefined; object.late = 1; return [before, Object.getOwnPropertyDescriptor(object, "late") !== undefined].join(" "); }
console.log("store in a callee |", "Object.getOwnPropertyDescriptor", "|", fill10({ first: 0 }));
class Named11 { static before = Reflect.getOwnPropertyDescriptor(Named11, "late") !== undefined; static late = 1; static behind = Reflect.getOwnPropertyDescriptor(Named11, "late") !== undefined; }
console.log("static field, class by name |", "Reflect.getOwnPropertyDescriptor", "|", Named11.before, Named11.behind);
class This11 { static before = Reflect.getOwnPropertyDescriptor(this, "late") !== undefined; static late = 1; static behind = Reflect.getOwnPropertyDescriptor(this, "late") !== undefined; }
console.log("static field, this |", "Reflect.getOwnPropertyDescriptor", "|", This11.before, This11.behind);
class Block11 { static before; static behind; static { this.before = Reflect.getOwnPropertyDescriptor(Block11, "late") !== undefined; } static late = 1; static { this.behind = Reflect.getOwnPropertyDescriptor(Block11, "late") !== undefined; } }
console.log("static block |", "Reflect.getOwnPropertyDescriptor", "|", Block11.before, Block11.behind);
class Field11 { before = Reflect.getOwnPropertyDescriptor(this, "late") !== undefined; late = 1; behind = Reflect.getOwnPropertyDescriptor(this, "late") !== undefined; }
{ const made = new Field11(); console.log("instance field |", "Reflect.getOwnPropertyDescriptor", "|", made.before, made.behind); }
class Made11 { constructor() { this.before = Reflect.getOwnPropertyDescriptor(this, "late") !== undefined; this.late = 1; this.behind = Reflect.getOwnPropertyDescriptor(this, "late") !== undefined; } }
{ const made = new Made11(); console.log("store in the constructor |", "Reflect.getOwnPropertyDescriptor", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = Reflect.getOwnPropertyDescriptor(object, "late") !== undefined; object.late = 1; console.log("store behind a literal |", "Reflect.getOwnPropertyDescriptor", "|", before, Reflect.getOwnPropertyDescriptor(object, "late") !== undefined); }
function fill11(object) { const before = Reflect.getOwnPropertyDescriptor(object, "late") !== undefined; object.late = 1; return [before, Reflect.getOwnPropertyDescriptor(object, "late") !== undefined].join(" "); }
console.log("store in a callee |", "Reflect.getOwnPropertyDescriptor", "|", fill11({ first: 0 }));
class Named12 { static before = "late" in Object.getOwnPropertyDescriptors(Named12); static late = 1; static behind = "late" in Object.getOwnPropertyDescriptors(Named12); }
console.log("static field, class by name |", "Object.getOwnPropertyDescriptors", "|", Named12.before, Named12.behind);
class This12 { static before = "late" in Object.getOwnPropertyDescriptors(this); static late = 1; static behind = "late" in Object.getOwnPropertyDescriptors(this); }
console.log("static field, this |", "Object.getOwnPropertyDescriptors", "|", This12.before, This12.behind);
class Block12 { static before; static behind; static { this.before = "late" in Object.getOwnPropertyDescriptors(Block12); } static late = 1; static { this.behind = "late" in Object.getOwnPropertyDescriptors(Block12); } }
console.log("static block |", "Object.getOwnPropertyDescriptors", "|", Block12.before, Block12.behind);
class Field12 { before = "late" in Object.getOwnPropertyDescriptors(this); late = 1; behind = "late" in Object.getOwnPropertyDescriptors(this); }
{ const made = new Field12(); console.log("instance field |", "Object.getOwnPropertyDescriptors", "|", made.before, made.behind); }
class Made12 { constructor() { this.before = "late" in Object.getOwnPropertyDescriptors(this); this.late = 1; this.behind = "late" in Object.getOwnPropertyDescriptors(this); } }
{ const made = new Made12(); console.log("store in the constructor |", "Object.getOwnPropertyDescriptors", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = "late" in Object.getOwnPropertyDescriptors(object); object.late = 1; console.log("store behind a literal |", "Object.getOwnPropertyDescriptors", "|", before, "late" in Object.getOwnPropertyDescriptors(object)); }
function fill12(object) { const before = "late" in Object.getOwnPropertyDescriptors(object); object.late = 1; return [before, "late" in Object.getOwnPropertyDescriptors(object)].join(" "); }
console.log("store in a callee |", "Object.getOwnPropertyDescriptors", "|", fill12({ first: 0 }));
class Named13 { static before = Object.entries(Named13).some(([key]) => key === "late"); static late = 1; static behind = Object.entries(Named13).some(([key]) => key === "late"); }
console.log("static field, class by name |", "Object.entries", "|", Named13.before, Named13.behind);
class This13 { static before = Object.entries(this).some(([key]) => key === "late"); static late = 1; static behind = Object.entries(this).some(([key]) => key === "late"); }
console.log("static field, this |", "Object.entries", "|", This13.before, This13.behind);
class Block13 { static before; static behind; static { this.before = Object.entries(Block13).some(([key]) => key === "late"); } static late = 1; static { this.behind = Object.entries(Block13).some(([key]) => key === "late"); } }
console.log("static block |", "Object.entries", "|", Block13.before, Block13.behind);
class Field13 { before = Object.entries(this).some(([key]) => key === "late"); late = 1; behind = Object.entries(this).some(([key]) => key === "late"); }
{ const made = new Field13(); console.log("instance field |", "Object.entries", "|", made.before, made.behind); }
class Made13 { constructor() { this.before = Object.entries(this).some(([key]) => key === "late"); this.late = 1; this.behind = Object.entries(this).some(([key]) => key === "late"); } }
{ const made = new Made13(); console.log("store in the constructor |", "Object.entries", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = Object.entries(object).some(([key]) => key === "late"); object.late = 1; console.log("store behind a literal |", "Object.entries", "|", before, Object.entries(object).some(([key]) => key === "late")); }
function fill13(object) { const before = Object.entries(object).some(([key]) => key === "late"); object.late = 1; return [before, Object.entries(object).some(([key]) => key === "late")].join(" "); }
console.log("store in a callee |", "Object.entries", "|", fill13({ first: 0 }));
class Named14 { static before = Object.values(Named14).includes(1); static late = 1; static behind = Object.values(Named14).includes(1); }
console.log("static field, class by name |", "Object.values", "|", Named14.before, Named14.behind);
class This14 { static before = Object.values(this).includes(1); static late = 1; static behind = Object.values(this).includes(1); }
console.log("static field, this |", "Object.values", "|", This14.before, This14.behind);
class Block14 { static before; static behind; static { this.before = Object.values(Block14).includes(1); } static late = 1; static { this.behind = Object.values(Block14).includes(1); } }
console.log("static block |", "Object.values", "|", Block14.before, Block14.behind);
class Field14 { before = Object.values(this).includes(1); late = 1; behind = Object.values(this).includes(1); }
{ const made = new Field14(); console.log("instance field |", "Object.values", "|", made.before, made.behind); }
class Made14 { constructor() { this.before = Object.values(this).includes(1); this.late = 1; this.behind = Object.values(this).includes(1); } }
{ const made = new Made14(); console.log("store in the constructor |", "Object.values", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = Object.values(object).includes(1); object.late = 1; console.log("store behind a literal |", "Object.values", "|", before, Object.values(object).includes(1)); }
function fill14(object) { const before = Object.values(object).includes(1); object.late = 1; return [before, Object.values(object).includes(1)].join(" "); }
console.log("store in a callee |", "Object.values", "|", fill14({ first: 0 }));
class Named15 { static before = "late" in { ...Named15 }; static late = 1; static behind = "late" in { ...Named15 }; }
console.log("static field, class by name |", "spread", "|", Named15.before, Named15.behind);
class This15 { static before = "late" in { ...this }; static late = 1; static behind = "late" in { ...this }; }
console.log("static field, this |", "spread", "|", This15.before, This15.behind);
class Block15 { static before; static behind; static { this.before = "late" in { ...Block15 }; } static late = 1; static { this.behind = "late" in { ...Block15 }; } }
console.log("static block |", "spread", "|", Block15.before, Block15.behind);
class Field15 { before = "late" in { ...this }; late = 1; behind = "late" in { ...this }; }
{ const made = new Field15(); console.log("instance field |", "spread", "|", made.before, made.behind); }
class Made15 { constructor() { this.before = "late" in { ...this }; this.late = 1; this.behind = "late" in { ...this }; } }
{ const made = new Made15(); console.log("store in the constructor |", "spread", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = "late" in { ...object }; object.late = 1; console.log("store behind a literal |", "spread", "|", before, "late" in { ...object }); }
function fill15(object) { const before = "late" in { ...object }; object.late = 1; return [before, "late" in { ...object }].join(" "); }
console.log("store in a callee |", "spread", "|", fill15({ first: 0 }));
class Named16 { static before = JSON.stringify({ ...Named16 }).includes("late"); static late = 1; static behind = JSON.stringify({ ...Named16 }).includes("late"); }
console.log("static field, class by name |", "JSON.stringify of a spread", "|", Named16.before, Named16.behind);
class This16 { static before = JSON.stringify({ ...this }).includes("late"); static late = 1; static behind = JSON.stringify({ ...this }).includes("late"); }
console.log("static field, this |", "JSON.stringify of a spread", "|", This16.before, This16.behind);
class Block16 { static before; static behind; static { this.before = JSON.stringify({ ...Block16 }).includes("late"); } static late = 1; static { this.behind = JSON.stringify({ ...Block16 }).includes("late"); } }
console.log("static block |", "JSON.stringify of a spread", "|", Block16.before, Block16.behind);
class Field16 { before = JSON.stringify({ ...this }).includes("late"); late = 1; behind = JSON.stringify({ ...this }).includes("late"); }
{ const made = new Field16(); console.log("instance field |", "JSON.stringify of a spread", "|", made.before, made.behind); }
class Made16 { constructor() { this.before = JSON.stringify({ ...this }).includes("late"); this.late = 1; this.behind = JSON.stringify({ ...this }).includes("late"); } }
{ const made = new Made16(); console.log("store in the constructor |", "JSON.stringify of a spread", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = JSON.stringify({ ...object }).includes("late"); object.late = 1; console.log("store behind a literal |", "JSON.stringify of a spread", "|", before, JSON.stringify({ ...object }).includes("late")); }
function fill16(object) { const before = JSON.stringify({ ...object }).includes("late"); object.late = 1; return [before, JSON.stringify({ ...object }).includes("late")].join(" "); }
console.log("store in a callee |", "JSON.stringify of a spread", "|", fill16({ first: 0 }));
class Named17 { static before = "late" in Object.assign({}, Named17); static late = 1; static behind = "late" in Object.assign({}, Named17); }
console.log("static field, class by name |", "Object.assign", "|", Named17.before, Named17.behind);
class This17 { static before = "late" in Object.assign({}, this); static late = 1; static behind = "late" in Object.assign({}, this); }
console.log("static field, this |", "Object.assign", "|", This17.before, This17.behind);
class Block17 { static before; static behind; static { this.before = "late" in Object.assign({}, Block17); } static late = 1; static { this.behind = "late" in Object.assign({}, Block17); } }
console.log("static block |", "Object.assign", "|", Block17.before, Block17.behind);
class Field17 { before = "late" in Object.assign({}, this); late = 1; behind = "late" in Object.assign({}, this); }
{ const made = new Field17(); console.log("instance field |", "Object.assign", "|", made.before, made.behind); }
class Made17 { constructor() { this.before = "late" in Object.assign({}, this); this.late = 1; this.behind = "late" in Object.assign({}, this); } }
{ const made = new Made17(); console.log("store in the constructor |", "Object.assign", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = "late" in Object.assign({}, object); object.late = 1; console.log("store behind a literal |", "Object.assign", "|", before, "late" in Object.assign({}, object)); }
function fill17(object) { const before = "late" in Object.assign({}, object); object.late = 1; return [before, "late" in Object.assign({}, object)].join(" "); }
console.log("store in a callee |", "Object.assign", "|", fill17({ first: 0 }));
class Named18 { static before = (({ before, ...rest }) => "late" in rest)(Named18); static late = 1; static behind = (({ before, ...rest }) => "late" in rest)(Named18); }
console.log("static field, class by name |", "rest", "|", Named18.before, Named18.behind);
class This18 { static before = (({ before, ...rest }) => "late" in rest)(this); static late = 1; static behind = (({ before, ...rest }) => "late" in rest)(this); }
console.log("static field, this |", "rest", "|", This18.before, This18.behind);
class Block18 { static before; static behind; static { this.before = (({ before, ...rest }) => "late" in rest)(Block18); } static late = 1; static { this.behind = (({ before, ...rest }) => "late" in rest)(Block18); } }
console.log("static block |", "rest", "|", Block18.before, Block18.behind);
class Field18 { before = (({ before, ...rest }) => "late" in rest)(this); late = 1; behind = (({ before, ...rest }) => "late" in rest)(this); }
{ const made = new Field18(); console.log("instance field |", "rest", "|", made.before, made.behind); }
class Made18 { constructor() { this.before = (({ before, ...rest }) => "late" in rest)(this); this.late = 1; this.behind = (({ before, ...rest }) => "late" in rest)(this); } }
{ const made = new Made18(); console.log("store in the constructor |", "rest", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = (({ before, ...rest }) => "late" in rest)(object); object.late = 1; console.log("store behind a literal |", "rest", "|", before, (({ before, ...rest }) => "late" in rest)(object)); }
function fill18(object) { const before = (({ before, ...rest }) => "late" in rest)(object); object.late = 1; return [before, (({ before, ...rest }) => "late" in rest)(object)].join(" "); }
console.log("store in a callee |", "rest", "|", fill18({ first: 0 }));
class Named19 { static before = (() => { for (const key in Named19) if (key === "late") return true; return false; })(); static late = 1; static behind = (() => { for (const key in Named19) if (key === "late") return true; return false; })(); }
console.log("static field, class by name |", "for-in", "|", Named19.before, Named19.behind);
class This19 { static before = (() => { for (const key in this) if (key === "late") return true; return false; })(); static late = 1; static behind = (() => { for (const key in this) if (key === "late") return true; return false; })(); }
console.log("static field, this |", "for-in", "|", This19.before, This19.behind);
class Block19 { static before; static behind; static { this.before = (() => { for (const key in Block19) if (key === "late") return true; return false; })(); } static late = 1; static { this.behind = (() => { for (const key in Block19) if (key === "late") return true; return false; })(); } }
console.log("static block |", "for-in", "|", Block19.before, Block19.behind);
class Field19 { before = (() => { for (const key in this) if (key === "late") return true; return false; })(); late = 1; behind = (() => { for (const key in this) if (key === "late") return true; return false; })(); }
{ const made = new Field19(); console.log("instance field |", "for-in", "|", made.before, made.behind); }
class Made19 { constructor() { this.before = (() => { for (const key in this) if (key === "late") return true; return false; })(); this.late = 1; this.behind = (() => { for (const key in this) if (key === "late") return true; return false; })(); } }
{ const made = new Made19(); console.log("store in the constructor |", "for-in", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = (() => { for (const key in object) if (key === "late") return true; return false; })(); object.late = 1; console.log("store behind a literal |", "for-in", "|", before, (() => { for (const key in object) if (key === "late") return true; return false; })()); }
function fill19(object) { const before = (() => { for (const key in object) if (key === "late") return true; return false; })(); object.late = 1; return [before, (() => { for (const key in object) if (key === "late") return true; return false; })()].join(" "); }
console.log("store in a callee |", "for-in", "|", fill19({ first: 0 }));
class Named20 { static before = Named20.late; static late = 1; static behind = Named20.late; }
console.log("static field, class by name |", "read", "|", Named20.before, Named20.behind);
class This20 { static before = this.late; static late = 1; static behind = this.late; }
console.log("static field, this |", "read", "|", This20.before, This20.behind);
class Block20 { static before; static behind; static { this.before = Block20.late; } static late = 1; static { this.behind = Block20.late; } }
console.log("static block |", "read", "|", Block20.before, Block20.behind);
class Field20 { before = this.late; late = 1; behind = this.late; }
{ const made = new Field20(); console.log("instance field |", "read", "|", made.before, made.behind); }
class Made20 { constructor() { this.before = this.late; this.late = 1; this.behind = this.late; } }
{ const made = new Made20(); console.log("store in the constructor |", "read", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = object.late; object.late = 1; console.log("store behind a literal |", "read", "|", before, object.late); }
function fill20(object) { const before = object.late; object.late = 1; return [before, object.late].join(" "); }
console.log("store in a callee |", "read", "|", fill20({ first: 0 }));
class Named21 { static before = Named21[lateKey]; static late = 1; static behind = Named21[lateKey]; }
console.log("static field, class by name |", "read by a computed key", "|", Named21.before, Named21.behind);
class This21 { static before = this[lateKey]; static late = 1; static behind = this[lateKey]; }
console.log("static field, this |", "read by a computed key", "|", This21.before, This21.behind);
class Block21 { static before; static behind; static { this.before = Block21[lateKey]; } static late = 1; static { this.behind = Block21[lateKey]; } }
console.log("static block |", "read by a computed key", "|", Block21.before, Block21.behind);
class Field21 { before = this[lateKey]; late = 1; behind = this[lateKey]; }
{ const made = new Field21(); console.log("instance field |", "read by a computed key", "|", made.before, made.behind); }
class Made21 { constructor() { this.before = this[lateKey]; this.late = 1; this.behind = this[lateKey]; } }
{ const made = new Made21(); console.log("store in the constructor |", "read by a computed key", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = object[lateKey]; object.late = 1; console.log("store behind a literal |", "read by a computed key", "|", before, object[lateKey]); }
function fill21(object) { const before = object[lateKey]; object.late = 1; return [before, object[lateKey]].join(" "); }
console.log("store in a callee |", "read by a computed key", "|", fill21({ first: 0 }));
class Named22 { static before = Reflect.get(Named22, "late"); static late = 1; static behind = Reflect.get(Named22, "late"); }
console.log("static field, class by name |", "Reflect.get", "|", Named22.before, Named22.behind);
class This22 { static before = Reflect.get(this, "late"); static late = 1; static behind = Reflect.get(this, "late"); }
console.log("static field, this |", "Reflect.get", "|", This22.before, This22.behind);
class Block22 { static before; static behind; static { this.before = Reflect.get(Block22, "late"); } static late = 1; static { this.behind = Reflect.get(Block22, "late"); } }
console.log("static block |", "Reflect.get", "|", Block22.before, Block22.behind);
class Field22 { before = Reflect.get(this, "late"); late = 1; behind = Reflect.get(this, "late"); }
{ const made = new Field22(); console.log("instance field |", "Reflect.get", "|", made.before, made.behind); }
class Made22 { constructor() { this.before = Reflect.get(this, "late"); this.late = 1; this.behind = Reflect.get(this, "late"); } }
{ const made = new Made22(); console.log("store in the constructor |", "Reflect.get", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = Reflect.get(object, "late"); object.late = 1; console.log("store behind a literal |", "Reflect.get", "|", before, Reflect.get(object, "late")); }
function fill22(object) { const before = Reflect.get(object, "late"); object.late = 1; return [before, Reflect.get(object, "late")].join(" "); }
console.log("store in a callee |", "Reflect.get", "|", fill22({ first: 0 }));
class Named23 { static before = (({ late }) => late)(Named23); static late = 1; static behind = (({ late }) => late)(Named23); }
console.log("static field, class by name |", "destructuring", "|", Named23.before, Named23.behind);
class This23 { static before = (({ late }) => late)(this); static late = 1; static behind = (({ late }) => late)(this); }
console.log("static field, this |", "destructuring", "|", This23.before, This23.behind);
class Block23 { static before; static behind; static { this.before = (({ late }) => late)(Block23); } static late = 1; static { this.behind = (({ late }) => late)(Block23); } }
console.log("static block |", "destructuring", "|", Block23.before, Block23.behind);
class Field23 { before = (({ late }) => late)(this); late = 1; behind = (({ late }) => late)(this); }
{ const made = new Field23(); console.log("instance field |", "destructuring", "|", made.before, made.behind); }
class Made23 { constructor() { this.before = (({ late }) => late)(this); this.late = 1; this.behind = (({ late }) => late)(this); } }
{ const made = new Made23(); console.log("store in the constructor |", "destructuring", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = (({ late }) => late)(object); object.late = 1; console.log("store behind a literal |", "destructuring", "|", before, (({ late }) => late)(object)); }
function fill23(object) { const before = (({ late }) => late)(object); object.late = 1; return [before, (({ late }) => late)(object)].join(" "); }
console.log("store in a callee |", "destructuring", "|", fill23({ first: 0 }));
class Named24 { static before = (({ late = "default" }) => late)(Named24); static late = 1; static behind = (({ late = "default" }) => late)(Named24); }
console.log("static field, class by name |", "destructuring with a default", "|", Named24.before, Named24.behind);
class This24 { static before = (({ late = "default" }) => late)(this); static late = 1; static behind = (({ late = "default" }) => late)(this); }
console.log("static field, this |", "destructuring with a default", "|", This24.before, This24.behind);
class Block24 { static before; static behind; static { this.before = (({ late = "default" }) => late)(Block24); } static late = 1; static { this.behind = (({ late = "default" }) => late)(Block24); } }
console.log("static block |", "destructuring with a default", "|", Block24.before, Block24.behind);
class Field24 { before = (({ late = "default" }) => late)(this); late = 1; behind = (({ late = "default" }) => late)(this); }
{ const made = new Field24(); console.log("instance field |", "destructuring with a default", "|", made.before, made.behind); }
class Made24 { constructor() { this.before = (({ late = "default" }) => late)(this); this.late = 1; this.behind = (({ late = "default" }) => late)(this); } }
{ const made = new Made24(); console.log("store in the constructor |", "destructuring with a default", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = (({ late = "default" }) => late)(object); object.late = 1; console.log("store behind a literal |", "destructuring with a default", "|", before, (({ late = "default" }) => late)(object)); }
function fill24(object) { const before = (({ late = "default" }) => late)(object); object.late = 1; return [before, (({ late = "default" }) => late)(object)].join(" "); }
console.log("store in a callee |", "destructuring with a default", "|", fill24({ first: 0 }));
class Named25 { static before = typeof Named25.late; static late = 1; static behind = typeof Named25.late; }
console.log("static field, class by name |", "typeof", "|", Named25.before, Named25.behind);
class This25 { static before = typeof this.late; static late = 1; static behind = typeof this.late; }
console.log("static field, this |", "typeof", "|", This25.before, This25.behind);
class Block25 { static before; static behind; static { this.before = typeof Block25.late; } static late = 1; static { this.behind = typeof Block25.late; } }
console.log("static block |", "typeof", "|", Block25.before, Block25.behind);
class Field25 { before = typeof this.late; late = 1; behind = typeof this.late; }
{ const made = new Field25(); console.log("instance field |", "typeof", "|", made.before, made.behind); }
class Made25 { constructor() { this.before = typeof this.late; this.late = 1; this.behind = typeof this.late; } }
{ const made = new Made25(); console.log("store in the constructor |", "typeof", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = typeof object.late; object.late = 1; console.log("store behind a literal |", "typeof", "|", before, typeof object.late); }
function fill25(object) { const before = typeof object.late; object.late = 1; return [before, typeof object.late].join(" "); }
console.log("store in a callee |", "typeof", "|", fill25({ first: 0 }));
class Named26 { static before = Named26.late ?? "absent"; static late = 1; static behind = Named26.late ?? "absent"; }
console.log("static field, class by name |", "??", "|", Named26.before, Named26.behind);
class This26 { static before = this.late ?? "absent"; static late = 1; static behind = this.late ?? "absent"; }
console.log("static field, this |", "??", "|", This26.before, This26.behind);
class Block26 { static before; static behind; static { this.before = Block26.late ?? "absent"; } static late = 1; static { this.behind = Block26.late ?? "absent"; } }
console.log("static block |", "??", "|", Block26.before, Block26.behind);
class Field26 { before = this.late ?? "absent"; late = 1; behind = this.late ?? "absent"; }
{ const made = new Field26(); console.log("instance field |", "??", "|", made.before, made.behind); }
class Made26 { constructor() { this.before = this.late ?? "absent"; this.late = 1; this.behind = this.late ?? "absent"; } }
{ const made = new Made26(); console.log("store in the constructor |", "??", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = object.late ?? "absent"; object.late = 1; console.log("store behind a literal |", "??", "|", before, object.late ?? "absent"); }
function fill26(object) { const before = object.late ?? "absent"; object.late = 1; return [before, object.late ?? "absent"].join(" "); }
console.log("store in a callee |", "??", "|", fill26({ first: 0 }));
class Named27 { static before = delete Named27.late; static late = 1; static behind = delete Named27.late; }
console.log("static field, class by name |", "delete", "|", Named27.before, Named27.behind);
class This27 { static before = delete this.late; static late = 1; static behind = delete this.late; }
console.log("static field, this |", "delete", "|", This27.before, This27.behind);
class Block27 { static before; static behind; static { this.before = delete Block27.late; } static late = 1; static { this.behind = delete Block27.late; } }
console.log("static block |", "delete", "|", Block27.before, Block27.behind);
class Field27 { before = delete this.late; late = 1; behind = delete this.late; }
{ const made = new Field27(); console.log("instance field |", "delete", "|", made.before, made.behind); }
class Made27 { constructor() { this.before = delete this.late; this.late = 1; this.behind = delete this.late; } }
{ const made = new Made27(); console.log("store in the constructor |", "delete", "|", made.before, made.behind); }
{ const object = { first: 0 }; const before = delete object.late; object.late = 1; console.log("store behind a literal |", "delete", "|", before, delete object.late); }
function fill27(object) { const before = delete object.late; object.late = 1; return [before, delete object.late].join(" "); }
console.log("store in a callee |", "delete", "|", fill27({ first: 0 }));

// GENERATED: fill6 fill11 fill12 Field1
// CHECK-LABEL: function {{*}}name="fill6"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|object flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Reflect
// CHECK-NEXT: v2 = Builtin builtin=ReflectHas
// CHECK-NEXT: v3 = String string="late"
// CHECK-NEXT: v4 = Call v2, v1, v0, v3 calleeName="Reflect.has"
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v6 = Integer integer=1
// CHECK-NEXT: PropSet v0, v6 key="late"
// CHECK-NEXT: v8 = Builtin builtin=Reflect
// CHECK-NEXT: v9 = Builtin builtin=ReflectHas
// CHECK-NEXT: v10 = String string="late"
// CHECK-NEXT: v11 = Call v9, v8, v0, v10 calleeName="Reflect.has"
// CHECK-NEXT: v12 = Convert v11 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v13 = NewArray v5, v12 contents=boolean
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|Array<boolean> flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="join"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v17 = String string=" "
// CHECK-NEXT: v18 = Call v16, v14, v17 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v18 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fill11"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Reflect
// CHECK-NEXT: v2 = Builtin builtin=ReflectGetOwnPropertyDescriptor
// CHECK-NEXT: v3 = String string="late"
// CHECK-NEXT: v4 = Call v2, v1, v0, v3 calleeName="Reflect.getOwnPropertyDescriptor"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|number|string|symbol|bigint|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v6 = TypeTest v5 testedType=undefined
// CHECK-NEXT: v7 = LogicalNot v6
// CHECK-NEXT: v8 = Convert v7 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v9 = Integer integer=1
// CHECK-NEXT: PropSet v0, v9 key="late"
// CHECK-NEXT: v11 = Builtin builtin=Reflect
// CHECK-NEXT: v12 = Builtin builtin=ReflectGetOwnPropertyDescriptor
// CHECK-NEXT: v13 = String string="late"
// CHECK-NEXT: v14 = Call v12, v11, v0, v13 calleeName="Reflect.getOwnPropertyDescriptor"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|number|string|symbol|bigint|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v16 = TypeTest v15 testedType=undefined
// CHECK-NEXT: v17 = LogicalNot v16
// CHECK-NEXT: v18 = NewArray v8, v17 contents=boolean
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|Array<boolean> flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="join"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v22 = String string=" "
// CHECK-NEXT: v23 = Call v21, v19, v22 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v23 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fill12"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectGetOwnPropertyDescriptors
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.getOwnPropertyDescriptors"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v5 = PropHas v4 key="late"
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: PropSet v0, v7 key="late"
// CHECK-NEXT: v9 = Builtin builtin=Object
// CHECK-NEXT: v10 = Builtin builtin=ObjectGetOwnPropertyDescriptors
// CHECK-NEXT: v11 = Call v10, v9, v0 calleeName="Object.getOwnPropertyDescriptors"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v13 = PropHas v12 key="late"
// CHECK-NEXT: v14 = NewArray v6, v13 contents=boolean
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|Array<boolean> flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="join"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v18 = String string=" "
// CHECK-NEXT: v19 = Call v17, v15, v18 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v19 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Field1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_5]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
