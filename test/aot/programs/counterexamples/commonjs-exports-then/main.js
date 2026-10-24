// `await import(..)` of a CommonJS module that exports a function `then` yields what `then` resolves with.
console.log((await import("./lib.cjs")).a);
