// `super.x` in a function that is not a method, or in an arrow function inside one, is an early error. Plain Bun rejects the file before it runs anything, and the build fails with the checker's error.
console.log("never printed");
(function () { return super.x; });
(function () { return () => super.x; });
