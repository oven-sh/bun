// `h.slice.call(arguments)` runs the `slice` that h has of its own, with the arguments object as `this`.
console.log((function () { const h = []; h.slice = function () { return Array.isArray(this); }; return h.slice.call(arguments); })());
