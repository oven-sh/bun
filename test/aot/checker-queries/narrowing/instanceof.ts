// `instanceof` narrows a union of classes in both branches.
class A { a = 1; }
class B { b = 1; }
declare const x: A | B;
if (x instanceof A) {
  x;
} else {
  x;
}
