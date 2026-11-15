// A name that the program binds is the program's own: nothing here reads the global, and nothing is reported.
// RUN: lower
// CHECK-NOT: key="ShadowRealm"

// FILE: main.js
import { Realm as ShadowRealm } from "./realm.js";

export const made = new ShadowRealm();
export const method = ShadowRealm.prototype.evaluate;

export function ofBlock() {
  class ShadowRealm {}
  return new ShadowRealm();
}

export function ofCatch() {
  try {
    throw Object;
  } catch (ShadowRealm) {
    return new ShadowRealm();
  }
}

export function ofVariable() {
  var ShadowRealm = Object;
  return new ShadowRealm();
}

// FILE: realm.js
export class Realm {
  evaluate() {}
}
