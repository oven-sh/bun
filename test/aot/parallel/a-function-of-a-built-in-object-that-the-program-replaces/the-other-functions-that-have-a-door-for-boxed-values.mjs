// The other functions of built-in objects that have a door for boxed values, each left open by a store that never runs.
if (process.argv.length > 7) { Array.isArray = Math.max = Math.min = Object.is = Object.getPrototypeOf = Object.setPrototypeOf = globalThis.isNaN = () => 0; }
const said = [];
for (let i = 0; i < 3; i++) said.push(Array.isArray([i]), Array.isArray(i), Math.max(i, 2), Math.min(i, 2), Object.is(i, 1), Object.getPrototypeOf([]) === Array.prototype, Object.setPrototypeOf({ i }, null).i, isNaN(i / 0 - i / 0));
console.log(said.join(" "));
