// Error.captureStackTrace(A) replaces the static field `stack` of a class.
class A { static stack = 1; static read() { return typeof A.stack; } }
Error.captureStackTrace(A);
console.log(A.read(), typeof A.stack, Object.getOwnPropertyDescriptor(A, "stack").value === A.stack);
