// `new.target` in an arrow function in a computed key of a class that an arrow function makes.
function t() { return () => class { [(() => new.target)()]() {} }; }
console.log(Object.getOwnPropertyNames(t()().prototype).join());
