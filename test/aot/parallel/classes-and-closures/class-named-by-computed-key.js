// An anonymous class named by a computed key already has its name when its members are defined: a static member `name` wins.
function describeName(C) {
  const d = Object.getOwnPropertyDescriptor(C, "name");
  if (!d) return "none";
  const value = "value" in d ? typeof d.value + " " + String(typeof d.value === "function" ? d.value() : d.value) : "accessor " + C.name;
  return value + ":" + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "");
}
function ownKeys(C) { return Reflect.ownKeys(C).map(String).join("+"); }
const keys = ["a", "b", Symbol("c"), Symbol(), "d"];

function makeNamed(key) { return { [key]: class { m() { return 1; } static s() { return 2; } } }[key]; }
const named = keys.map(makeNamed);
console.log("named:", named.map(describeName).join(" | "));
console.log("members:", named.map(C => [new C().m(), C.s(), ownKeys(C)].join()).join(" | "));
console.log("distinct:", new Set(named).size, new Set(named.map(C => C.prototype)).size);

function makeWithNameMethod(key) { return { [key]: class { static name() { return "method"; } } }[key]; }
function makeWithNameGetter(key) { return { [key]: class { static get name() { return "getter"; } } }[key]; }
function makeWithNameField(key) { return { [key]: class { static name = "field"; } }[key]; }
function makeWithOwnName(key) { return { [key]: class Own {} }[key]; }
for (const make of [makeWithNameMethod, makeWithNameGetter, makeWithNameField, makeWithOwnName])
  console.log(make.name + ":", keys.map(key => describeName(make(key))).join(" | "), ownKeys(make("a")));

function makeInFields(key) { return class Holder { [key] = class {}; static [key] = class { static s() { return 3; } }; }; }
console.log("in fields:", ["x", "y"].map(key => { const Holder = makeInFields(key); return [new Holder()[key].name, Holder[key].name, Holder[key].s()].join(); }).join(" | "));

function Base() {}
Base.inherited = () => "inherited";
Base.prototype.hello = function () { return "hello"; };
const onceKey = "Once" + keys.length;
const Once = { [onceKey]: class extends Base { m() { return "m"; } static s() { return "s"; } } }[onceKey];
console.log("evaluated once:", describeName(Once), ownKeys(Once), new Once().m(), new Once().hello(), Once.s(), Once.inherited(), Object.getPrototypeOf(Once) === Base);
class Known { hello() { return "known"; } static inherited() { return "static of " + this.name; } }
const Derived = { [onceKey]: class extends Known { m() { return "m"; } } }[onceKey];
console.log("evaluated once, a class as base:", describeName(Derived), ownKeys(Derived), new Derived().m(), new Derived().hello(), Derived.inherited(), Object.getPrototypeOf(Derived) === Known);
