// Static class fields that are initialized after a closure has captured the class.
class C {
  static label = "a!";
  static n = 0;
  static next(): number { return ++C.n; }
}
console.log(C.label, C.n, C.next(), C.next(), Object.keys(C).join(), "label" in C, (C as any).label);
