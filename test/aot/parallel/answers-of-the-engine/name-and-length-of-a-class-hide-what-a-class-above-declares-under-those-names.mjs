// A class object has a `name`, a `length` and a `prototype` of its own. No record lists them. They hide whatever a class above declares under those names: `static get name() {}`, a setter, a method, a static field.
// A lookup through the row of classes went past them: `Below.name` gave what the getter of the class above returns, `Below.length` undefined below a setter.
// classHolderIsMadeWithName(): LinkFlow::membersFoundUnder(), LinkTables::findMember() and the static fields in resolveOnClassObject() end at the first class.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
class Getters { static get name() { return "the getter"; } static get length() { return "the other getter"; } }
class BelowGetters extends Getters { constructor(first, second) { super(); } }
class Setters { static set name(value) { report("the setter is called"); } static set length(value) { report("the other setter is called"); } }
class BelowSetters extends Setters { constructor(first) { super(); } }
class Methods { static name() { return "the method"; } static length() { return "the other method"; } }
class BelowMethods extends Methods {}
class Fields { static name = 5; static length = "a text"; }
class BelowFields extends Fields { constructor(first, second, third) { super(); } }
report(BelowGetters.name);
report(BelowGetters.length);
report(Getters.name);
report(Getters.length);
report(BelowSetters.name);
report(BelowSetters.length);
report(Setters.name);
report(Setters.length);
report(BelowMethods.name);
report(BelowMethods.length);
report(Methods.name());
report(Methods.length());
report(BelowFields.name);
report(BelowFields.length + 1);
report(Fields.name + 1);
report(Fields.length);
function nameOf(klass) { return klass.name; }
function lengthOf(klass) { return klass.length; }
report(nameOf(BelowGetters));
report(nameOf(Getters));
report(nameOf(BelowFields));
report(nameOf(Fields));
report(lengthOf(BelowGetters));
report(lengthOf(Getters));
report(lengthOf(BelowFields));
report(lengthOf(Fields));
let thrown = "nothing is thrown";
try { BelowSetters.name = "stored"; }
catch (error) { thrown = "the store throws"; }
report(thrown);
report(BelowSetters.name);
report(BelowGetters.prototype === Getters.prototype);
report(new BelowGetters().constructor.name);
report("end");
