// The code of a CommonJS file is the body of a function that is called, not constructed: `new.target` is allowed at its top and is undefined, in arrow functions there too.
const inArrow = () => new.target;
console.log(typeof new.target, new.target === undefined, typeof inArrow());
function Made() { return [typeof new.target, (() => typeof new.target)()]; }
console.log(new Made().join(), Made().join());
module.exports = typeof new.target;
console.log(module.exports);
