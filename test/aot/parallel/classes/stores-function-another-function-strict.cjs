// Stores to a function below another function strict.
"use strict";
const log = [];
function attempt(label, action) {
  try {
    const answer = action();
    log.push(label + ": " + String(answer));
  } catch (error) {
    log.push(label + ": threw " + error.constructor.name);
  }
}
function own(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return "none";
  return ("value" in descriptor ? "value " + String(descriptor.value) : "accessor") + " " + [descriptor.writable, descriptor.enumerable, descriptor.configurable].join("");
}

class A {
  static field = 5;
  static method() { return "A.method"; }
  static set setter(value) { log.push("setter of A on " + this.name + " gets " + value); }
  static get getterOnly() { return "got"; }
  static storeThroughSuper(value) { super.viaSuper = value; return own(this, "viaSuper"); }
}
Object.defineProperty(A, "fixed", { value: "fixed", writable: false, enumerable: true, configurable: true });
class B extends A {
  static storeThroughSuper(value) { super.viaSuper = value; return own(this, "viaSuper"); }
}
class C extends B {}

attempt("plain", () => { B.plain = 1; return [own(B, "plain"), own(A, "plain"), C.plain, A.plain].join(" | "); });
attempt("plain again", () => { B.plain = 2; return [own(B, "plain"), C.plain].join(" | "); });
attempt("over a field", () => { B.field = 6; return [own(B, "field"), A.field, C.field].join(" | "); });
attempt("over a method", () => { B.method = () => "B.method"; return [B.method(), A.method(), C.method()].join(" | "); });
attempt("through a setter", () => { B.setter = 7; return own(B, "setter"); });
attempt("past a getter alone", () => { B.getterOnly = 8; return own(B, "getterOnly"); });
attempt("past a fixed value", () => { B.fixed = 9; return own(B, "fixed"); });
attempt("at the third level", () => { C.deep = 1; return [own(C, "deep"), own(B, "deep"), own(A, "deep")].join(" | "); });
attempt("a symbol", () => { const key = Symbol("key"); C[key] = 1; return [own(C, key), own(B, key)].join(" | "); });
attempt("prototype", () => { B.prototype = {}; return own(B, "prototype").slice(0, 5); });
attempt("name", () => { B.name = "renamed"; return B.name; });
attempt("length", () => { B.length = 3; return B.length; });
attempt("displayName", () => { B.displayName = "shown"; return own(B, "displayName"); });
attempt("__proto__", () => { class D extends A {} D.__proto__ = C; return [Object.getPrototypeOf(D) === C, own(D, "__proto__")].join(" "); });
attempt("Reflect.set", () => [Reflect.set(B, "reflected", 1), own(B, "reflected")].join(" "));
attempt("Reflect.set with a receiver", () => [Reflect.set(A, "received", 1, C), own(C, "received"), own(A, "received")].join(" | "));
attempt("super in A", () => A.storeThroughSuper(1));
attempt("super in B", () => B.storeThroughSuper(2));
attempt("super in B on C", () => C.storeThroughSuper(3));
attempt("Object.assign", () => { Object.assign(C, { one: 1, two: 2, setter: 3 }); return [own(C, "one"), own(C, "two"), own(C, "setter")].join(" | "); });
attempt("deleted and stored", () => { delete B.plain; B.plain = 3; return [own(B, "plain"), Object.keys(B).join(",")].join(" | "); });
attempt("a setter defined later above", () => {
  Object.defineProperty(A, "late", { set(value) { log.push("late setter on " + this.name + " gets " + value); }, configurable: true });
  C.late = 1;
  return own(C, "late");
});
attempt("not extensible", () => { class E extends A {} Object.preventExtensions(E); E.more = 1; return own(E, "more"); });
attempt("frozen", () => { class F extends A {} F.had = 1; Object.freeze(F); F.had = 2; F.more = 1; return [own(F, "had"), own(F, "more")].join(" | "); });
attempt("a proxy above", () => {
  class G {}
  Object.setPrototypeOf(G, new Proxy(A, { set(target, key, value, receiver) { log.push("trap for " + String(key) + " on " + receiver.name); return true; } }));
  G.trapped = 1;
  return own(G, "trapped");
});
attempt("an ordinary object above", () => {
  class H {}
  Object.setPrototypeOf(H, { set caught(value) { log.push("caught " + value); }, kept: 1 });
  H.caught = 1;
  H.kept = 2;
  H.fresh = 3;
  return [own(H, "caught"), own(H, "kept"), own(H, "fresh")].join(" | ");
});
attempt("null above", () => { class I {} Object.setPrototypeOf(I, null); I.alone = 1; return own(I, "alone"); });

function Parent() {}
Parent.shared = "shared";
Parent.helper = function () { return "helper of " + this.name; };
function Child() {}
Object.setPrototypeOf(Child, Parent);
function Grandchild() {}
Object.setPrototypeOf(Grandchild, Child);
attempt("functions: plain", () => { Child.plain = 1; return [own(Child, "plain"), own(Parent, "plain"), Grandchild.plain].join(" | "); });
attempt("functions: over an inherited value", () => { Child.shared = "mine"; return [Child.shared, Parent.shared, Grandchild.shared].join(" | "); });
attempt("functions: many", () => {
  for (const key of ["a", "b", "c", "d", "e", "f", "g", "h"]) Grandchild[key] = key;
  return Object.keys(Grandchild).join("");
});
attempt("functions: named members", () => { Child.Readable = Parent; Child.Writable = Grandchild; Child.Child = Child; return Object.keys(Child).join(","); });
attempt("functions: helper", () => [Child.helper(), Grandchild.helper()].join(" | "));
attempt("functions: a setter above", () => {
  Object.defineProperty(Parent, "watched", { set(value) { log.push("watched on " + this.name + " gets " + value); }, configurable: true });
  Grandchild.watched = 1;
  return own(Grandchild, "watched");
});
const arrow = () => 1;
Object.setPrototypeOf(arrow, Child);
attempt("an arrow function below", () => { arrow.extra = 1; return [own(arrow, "extra"), arrow.plain].join(" | "); });
const bound = Child.bind(null);
Object.setPrototypeOf(bound, Child);
attempt("a bound function below", () => { bound.extra = 1; return own(bound, "extra"); });
function readStatics(constructor) { return [constructor.plain, constructor.field, constructor.deep].join(" "); }
for (const constructor of [A, B, C]) log.push(constructor.name + ": " + readStatics(constructor));
console.log(log.join("\n"));
