// Error.captureStackTrace(A) replaces the static fields `originalLine` and `originalColumn` of a class.
class A { static originalLine = "l"; static z = 1; static originalColumn = "c"; static read() { return [typeof A.originalLine, typeof A.originalColumn, A.z]; } }
Error.captureStackTrace(A);
console.log(JSON.stringify([A.read(), Reflect.ownKeys(A), Object.keys(A)]));
