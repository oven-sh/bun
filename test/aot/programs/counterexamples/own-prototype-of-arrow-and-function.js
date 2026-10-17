// `Object.hasOwn(f, "prototype")` is false for an arrow function and true for the function asked about next.
console.log(Object.hasOwn(() => 1, "prototype"), Object.hasOwn(function () {}, "prototype"));
