// `Error.captureStackTrace(C)` on a class leaves the class as it was.
class C {}
Error.captureStackTrace(C);
console.log(C.name);
