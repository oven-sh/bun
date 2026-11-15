// `Object.create(parent)` is an allocation of a layout of the call's own only where the body that makes the object stores on it under a written name. Every other call stays a call and makes a plain object.
// Below a written null the object is a record. It stays a plain one where the file stores on it under a computed key, hands it to Object.create as the parent or defines on it by a descriptor that lays more than a value or a getter, in a nested function too.
// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: builtin=ObjectCreate
// CHECK: [[below]] = NewObject layout=
// CHECK-NEXT: SetLiteralPrototype [[below]], {{*}} [refusesOtherValues]
// CHECK-NEXT: [[namespace]] = FinishObject [[below]]
// CHECK: PropSet [[namespace]], {{*}}key="name"
// CHECK: builtin=ObjectCreate
// CHECK-NOT: SetLiteralPrototype
// CHECK: builtin=ObjectCreate
// CHECK-NOT: SetLiteralPrototype
// CHECK: builtin=ObjectCreate
// CHECK-NOT: SetLiteralPrototype
// CHECK: builtin=ObjectCreate
// CHECK: SetLiteralPrototype {{*}} [refusesOtherValues]
// CHECK-NOT: SetLiteralPrototype
// CHECK-LABEL: function {{*}}name="anotherNameIsStoredOn"
// CHECK: builtin=ObjectCreate
// CHECK-NOT: SetLiteralPrototype
// CHECK-LABEL: function {{*}}name="belowNull"
// CHECK: builtin=ObjectCreate
// CHECK: [[bare]] = NewObject layout=
// CHECK-NEXT: SetLiteralPrototype [[bare]], {{*}} [refusesOtherValues]
// CHECK-LABEL: function {{*}}name="belowNullAndATable"
// CHECK: builtin=ObjectCreate
// CHECK-NOT: SetLiteralPrototype
// CHECK-LABEL: function {{*}}name="belowThePrototypeOfAFunction"
// CHECK: builtin=ObjectCreate
// CHECK-NOT: SetLiteralPrototype
// CHECK-LABEL: function {{*}}name="handedOn"
// CHECK: builtin=ObjectCreate
// CHECK-NOT: SetLiteralPrototype
// CHECK-LABEL: function {{*}}name="holderOfGetters"
// CHECK: builtin=ObjectCreate
// CHECK-NOT: SetLiteralPrototype
// CHECK-LABEL: function {{*}}name="maker"
// CHECK: builtin=ObjectCreate
// CHECK: [[head]] = NewObject layout=
// CHECK-NEXT: SetLiteralPrototype [[head]], {{*}} [refusesOtherValues]
// CHECK-NEXT: [[made]] = FinishObject [[head]]
// CHECK: PropSet [[made]], {{*}}key="name"
// CHECK-LABEL: function {{*}}name="makerInATry"
// CHECK: builtin=ObjectCreate
// CHECK: = NewObject layout=
// CHECK-LABEL: function {{*}}name="makerThroughAStore"
// CHECK: builtin=ObjectCreate
// CHECK: = NewObject layout=
// CHECK: = NewObject layout=
// CHECK-LABEL: function {{*}}name="storedOnByAnotherBody"
// CHECK: builtin=ObjectCreate
// CHECK-NOT: SetLiteralPrototype
// CHECK-LABEL: function {{*}}name="tableOfNames"
// CHECK: builtin=ObjectCreate
// CHECK-NOT: SetLiteralPrototype

export function maker(parent, value) {
  const made = Object.create(parent);
  made.name = value;
  return made;
}

export function makerThroughAStore(parent, other) {
  const context = Object.create(parent);
  const request = (context.request = Object.create(other));
  request.context = context;
  return context;
}

export function makerInATry(parent) {
  const made = Object.create(parent);
  try {
    made.name = 1;
  } catch {}
  return made;
}

export function holderOfGetters(parent, names, getterOf) {
  const flags = Object.create(parent);
  for (const name of names) Object.defineProperty(flags, name, { get: getterOf(name) });
  return flags;
}

export function tableOfNames(parent, names) {
  const table = Object.create(parent);
  for (const name of names) table[name] = true;
  return table;
}

export function storedOnByAnotherBody(parent) {
  const made = Object.create(parent);
  return () => {
    made.name = 1;
    return made;
  };
}

export function handedOn(parent, take) {
  return take(Object.create(parent));
}

export function anotherNameIsStoredOn(parent, other) {
  const made = Object.create(parent);
  other.name = made;
  return other;
}

export function belowThePrototypeOfAFunction(Above) {
  const made = Object.create(Above.prototype);
  made.name = 1;
  return made;
}

export function belowNull() {
  const made = Object.create(null);
  made.name = 1;
  return made;
}

export function belowNullAndATable(keys) {
  const counts = Object.create(null);
  counts.total = 0;
  for (const key of keys) counts[key] = (counts[key] || 0) + 1;
  return counts;
}

const namespaceBelowNull = Object.create(null);
namespaceBelowNull.name = 1;
const definedOnBelowNull = Object.create(null);
definedOnBelowNull.name = 1;
Object.defineProperty(definedOnBelowNull, "got", { get() { return 1; }, set(given) {} });
const parentBelowNull = Object.create(null);
parentBelowNull.name = 1;
export const belowTheParent = () => Object.create(parentBelowNull);
const tableBelowNull = Object.create(null);
for (const name of ["a", "b"]) tableBelowNull[name] = true;
const madeInALoop = [];
for (let turn = 0; turn < 2; turn++) {
  const made = Object.create(null);
  made.name = turn;
  madeInALoop.push(made);
}
export { definedOnBelowNull, madeInALoop, namespaceBelowNull, parentBelowNull, tableBelowNull };
