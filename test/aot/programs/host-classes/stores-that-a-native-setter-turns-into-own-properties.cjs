// `self`, `process.ppid`, `process.title` and `require.cache` have native setters. The first, the second and the last put an ordinary property in the place of the accessor.
console.log(typeof self, self === globalThis);
self = 5;
console.log(self, globalThis.self, Object.getOwnPropertyDescriptor(globalThis, "self").value);
console.log(process.ppid > 0);
process.ppid = 7;
console.log(process.ppid, Object.getOwnPropertyDescriptor(process, "ppid").value);
process.title = "named";
console.log(process.title);
console.log(typeof require.cache, typeof require.extensions);
require.cache = { a: 1 };
console.log(require.cache.a);
