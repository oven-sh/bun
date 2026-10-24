// An arrow function whose body is the call of Symbol: the symbol it returns names a property, and a function with a local in between does the same.
const direct = () => Symbol("a");
const throughLocal = () => { const made = Symbol("b"); return made; };
const first = direct();
const second = throughLocal();
const o = { [first]: 1, [second]: 2 };
const keys = Reflect.ownKeys(o);
console.log(keys.length, keys[0] === first, keys[1] === second, o[first], o[second]);
