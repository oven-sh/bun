// `Object.create(parent)` is an allocation of a layout of the call's own only where the body that makes the object stores on it under a written name. Every other call stays a call and makes a plain object.
// RUN: lower
// CHECK-LABEL: function {{*}}name="anotherNameIsStoredOn"
// CHECK-NOT: = NewObject
// CHECK: builtin=ObjectCreate
// CHECK-LABEL: function {{*}}name="belowNull"
// CHECK-NOT: = NewObject
// CHECK: builtin=ObjectCreate
// CHECK-LABEL: function {{*}}name="belowThePrototypeOfAFunction"
// CHECK-NOT: = NewObject
// CHECK: builtin=ObjectCreate
// CHECK-LABEL: function {{*}}name="handedOn"
// CHECK-NOT: = NewObject
// CHECK: builtin=ObjectCreate
// CHECK-LABEL: function {{*}}name="holderOfGetters"
// CHECK-NOT: = NewObject
// CHECK: builtin=ObjectCreate
// CHECK-LABEL: function {{*}}name="maker"
// CHECK-NOT: builtin=ObjectCreate
// CHECK: [[head]] = NewObject layout=
// CHECK-NEXT: SetLiteralPrototype [[head]], {{*}} [refusesOtherValues]
// CHECK-NEXT: [[made]] = FinishObject [[head]]
// CHECK: PropSet [[made]], {{*}}key="name"
// CHECK-LABEL: function {{*}}name="makerInATry"
// CHECK-NOT: builtin=ObjectCreate
// CHECK: = NewObject layout=
// CHECK-LABEL: function {{*}}name="makerThroughAStore"
// CHECK-NOT: builtin=ObjectCreate
// CHECK: = NewObject layout=
// CHECK: = NewObject layout=
// CHECK-LABEL: function {{*}}name="storedOnByAnotherBody"
// CHECK-NOT: = NewObject
// CHECK: builtin=ObjectCreate
// CHECK-LABEL: function {{*}}name="tableOfNames"
// CHECK-NOT: = NewObject
// CHECK: builtin=ObjectCreate

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
