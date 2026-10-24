// A property is stored under the symbol that a call returns: the key that Reflect.ownKeys lists is that symbol.
function key() { return Symbol("a"); }
const k = key();
const o = {};
o[k] = 1;
console.log(Reflect.ownKeys(o)[0] === k);
