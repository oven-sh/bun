// RUN: lower
// DIAGNOSTIC: TS1034 1

var C = class extends B {
  #x() {}
  method() { super.#x(); }
};
