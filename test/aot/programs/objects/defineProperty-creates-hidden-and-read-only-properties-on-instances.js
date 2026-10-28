// Instances get data properties from Object.defineProperty, with every combination of attributes, from a literal descriptor, a shared descriptor and a helper.
"use strict";
const shared = { value: undefined, enumerable: false };
function Internals(def) {
  this.def = def;
}
function attach(instance, def) {
  shared.value = new Internals(def);
  Object.defineProperty(instance, "internals", shared);
  shared.value = undefined;
}
function ThroughHelper(def) {
  this.kind = "helper";
  attach(this, def);
  this.after = 1;
}
function WithLiteral(def) {
  this.kind = "literal";
  Object.defineProperty(this, "internals", { value: new Internals(def), enumerable: false });
  this.after = 2;
}
class Hidden {
  constructor(def) {
    this.kind = "class";
    Object.defineProperty(this, "internals", { value: new Internals(def), writable: true, configurable: true });
    Reflect.defineProperty(this, "fixed", { value: def.n * 2, enumerable: true });
    this.after = 3;
  }
}
class InTwoForms {
  constructor(def, isHidden) {
    this.kind = "two forms";
    if (isHidden) Object.defineProperty(this, "internals", { value: new Internals(def) });
    else this.internals = new Internals(def);
  }
}

function attempt(what, run) {
  try {
    return `${what}: ${JSON.stringify(run())}`;
  } catch (error) {
    return `${what}: ${error.constructor.name}`;
  }
}

function describe(object) {
  const lines = [];
  lines.push(`${object.kind}: ${object.internals.def.n}`);
  lines.push(`keys ${Object.keys(object)}`);
  lines.push(`names ${Object.getOwnPropertyNames(object)}`);
  lines.push(`own keys ${Reflect.ownKeys(object).join()}`);
  const inLoop = [];
  for (const key in object) inLoop.push(key);
  lines.push(`for-in ${inLoop}`);
  lines.push(`json ${JSON.stringify(object)}`);
  lines.push(`spread ${JSON.stringify({ ...object })}`);
  lines.push(`assign ${JSON.stringify(Object.assign({}, object))}`);
  lines.push(`entries ${JSON.stringify(Object.entries(object))}`);
  for (const name of ["internals", "fixed", "kind"]) {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    lines.push(`${name} ${descriptor ? [descriptor.writable, descriptor.enumerable, descriptor.configurable] : "absent"}`);
    lines.push(`${name} in ${name in object}, own ${Object.hasOwn(object, name)}, enumerable ${Object.prototype.propertyIsEnumerable.call(object, name)}`);
  }
  const before = object.internals;
  lines.push(attempt("store", () => ((object.internals = 1), object.internals === 1)));
  lines.push(attempt("store by key", () => ((object["inter" + "nals"] = 2), object.internals === 2)));
  lines.push(attempt("Reflect.set", () => Reflect.set(object, "internals", before)));
  lines.push(attempt("define again", () => (Object.defineProperty(object, "internals", { value: before }), object.internals === before)));
  lines.push(attempt("define another value", () => (Object.defineProperty(object, "internals", { value: 3 }), object.internals)));
  lines.push(attempt("make enumerable", () => (Object.defineProperty(object, "internals", { enumerable: true }), Object.keys(object))));
  lines.push(attempt("delete", () => delete object.internals));
  lines.push(attempt("Reflect.deleteProperty", () => Reflect.deleteProperty(object, "internals")));
  lines.push(`left ${typeof object.internals}, names ${Object.getOwnPropertyNames(object)}`);
  lines.push(attempt("store after", () => ((object.internals = before), Object.keys(object))));
  lines.push(attempt("frozen", () => (Object.freeze(object), [Object.isFrozen(object), Object.isSealed(object)])));
  return lines.join("\n");
}

function sum(list) {
  let total = 0;
  for (const item of list) total += item.internals.def.n;
  return total;
}

const made = [
  def => new ThroughHelper(def),
  def => new WithLiteral(def),
  def => new Hidden(def),
  def => new InTwoForms(def, true),
  def => new InTwoForms(def, false),
];
for (const make of made) {
  const list = [make({ n: 1 }), make({ n: 2 }), make({ n: 3 })];
  let total = 0;
  for (let i = 0; i < 100; i++) total += sum(list);
  console.log(total);
  console.log(describe(list[0]));
  console.log(sum(list.slice(1)));
}
