// Error.captureStackTrace(C) lays `stack` on C in native code: what compiled code kept of a static field of that name in a variable is no longer the value.
class A {
  static stack = "mine";
  static other = 1;
}
function readInLoop(n) {
  let kept = 0;
  for (let i = 0; i < n; i++) if (A.stack === "mine") kept++;
  return kept;
}
console.log(readInLoop(50));
Error.captureStackTrace(A);
console.log(readInLoop(50), typeof A.stack, A.other);
A.stack = "mine";
console.log(readInLoop(3), Object.keys(A).join(), Reflect.ownKeys(A).filter(key => !key.startsWith("original")).join());

class B {
  static first = 1;
  static stack = 2;
  static last = 3;
  static next() { return B.stack + B.last; }
}
console.log(B.next());
Object.keys(B);
Error.captureStackTrace(B);
console.log(typeof B.next(), B.next() === 5, Reflect.ownKeys(B).filter(key => !key.startsWith("original")).join());

class C {
  static stack = "held";
  static take() { return this.stack; }
}
class D extends C {}
console.log(C.take(), D.take(), D.stack);
Error.captureStackTrace(D);
console.log(C.take(), D.take() === "held", D.stack === "held");
Error.captureStackTrace(C);
console.log(C.take() === "held", D.stack === "held", delete D.stack, D.stack === "held", D.stack === C.stack);

class E {
  static stack;
  static count = 0;
}
for (let i = 0; i < 3; i++) {
  E.count++;
  if (i === 1) Error.captureStackTrace(E);
  console.log(E.count, typeof E.stack);
}
E.stack = 7;
console.log(E.stack, JSON.stringify(Object.getOwnPropertyDescriptor(E, "stack")));
const capture = Error.captureStackTrace;
class F {
  static stack = 1;
  static #hidden = 2;
  static get hidden() { return F.#hidden; }
}
capture(F);
console.log(typeof F.stack, F.hidden, Object.getOwnPropertyDescriptor(F, "stack").enumerable);
