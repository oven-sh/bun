// RUN: link
// CHECK: layout {{*}}name="Written" {{*}}supertypes=[{{*}}[[t]]]
// CHECK: layout [[t]] flags=[IsTypeParameter, IsNeverAllocated]
// CHECK: function {{*}}name="Box" module={{*}}parameters=[{type=undefined|null|[[t]] site=

// RUN(MENTIONED): link
// MENTIONED: layout {{*}}name="Mentioned" {{*}}supertypes=[{{*}}[[t]]]
// MENTIONED: layout [[t]] flags=[IsTypeParameter, IsNeverAllocated]
// MENTIONED: function {{*}}name="Box" module={{*}}parameters=[{type=undefined|null|[[t]] site=

// RUN(INFERRED): link
// INFERRED: layout {{*}}name="Inferred" {{*}}supertypes=[{{*}}[[t]]]
// INFERRED: layout [[t]] flags=[IsTypeParameter, IsNeverAllocated]
// INFERRED: function {{*}}name="wrap" module={{*}}parameters=[{type=undefined|null|[[t]] site=

// RUN(FORWARDED): link
// FORWARDED: layout {{*}}name="Forwarded" {{*}}supertypes=[{{*}}[[u]]]
// FORWARDED: layout [[u]] supertypes=[{{*}}[[t]]] flags=[IsTypeParameter, IsNeverAllocated]
// FORWARDED: function {{*}}name="forward" module={{*}}parameters=[{type=undefined|null|[[u]] site=
// FORWARDED: function {{*}}name="wrap" module={{*}}parameters=[{type=undefined|null|[[t]] site=

// RUN(NUMBER): link
// NUMBER: layout {{*}}kind=Instance name="Cell" {{*}}key="value" declared={type=undefined|null|[[t]] site=
// NUMBER: layout [[t]] flags=[HasMembersWithoutLayout, IsTypeParameter, IsNeverAllocated]

// RUN(OTHERS): link
// OTHERS-NOT: layout {{*}}name="Stranger"{{*}}supertypes=
// OTHERS-NOT: layout {{*}}name="Written"{{*}}supertypes=[{{*}},
// OTHERS-NOT: layout {{*}}name="Forwarded"{{*}}supertypes=[{{*}},

// What a program puts in the place of a type parameter is below the layout of the type parameter: a type argument that is written at a construction, one that only a class type in an annotation names, and one that the checker infers at a call. A type parameter that is the argument of another one is below it, so what reaches the first reaches the second through it and has no edge of its own. An argument without a layout, here a number, leaves its mark on the type parameter. A type that is nobody's type argument is below nothing.
interface Forwarded {
  forwarded: string;
}

interface Inferred {
  inferred: string;
}

interface Mentioned {
  mentioned: string;
}

interface Stranger {
  stranger: string;
}

interface Written {
  written: string;
}

class Box<T> {
  value: T;

  constructor(value: T) {
    this.value = value;
  }
}

class Cell<T> {
  value: T;

  constructor(value: T) {
    this.value = value;
  }
}

function forward<U>(value: U) {
  wrap(value);
}

function wrap<T>(value: T) {}

export function construct(written: Written) {
  return new Box<Written>(written);
}

export function count() {
  return new Cell(1);
}

export function keep(stranger: Stranger) {
  return stranger;
}

export function pass(forwarded: Forwarded, inferred: Inferred) {
  forward(forwarded);
  wrap(inferred);
}

export function read(box: Box<Mentioned>) {
  return box.value;
}
