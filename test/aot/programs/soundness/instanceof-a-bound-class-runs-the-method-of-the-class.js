// `x instanceof bound` asks the target of the bound function: the static method under Symbol.hasInstance of the class that was bound runs, and nothing else in the program calls it.
class C { static [Symbol.hasInstance]() { return true; } }
const b = C.bind(null);
console.log({} instanceof b);
