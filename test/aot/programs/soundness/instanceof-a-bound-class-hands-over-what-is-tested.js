// `x instanceof bound` in a function, with several values: the method under Symbol.hasInstance of the bound class gets each value and reads a field of it.
class C { static [Symbol.hasInstance](value) { return value.marked === true; } }
const b = C.bind(null);
function test(value) { return value instanceof b; }
console.log(test({ marked: true }), test({ marked: false }), test(1));
