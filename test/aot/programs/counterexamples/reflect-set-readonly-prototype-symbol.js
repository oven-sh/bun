// `Reflect.set(map, Symbol.toStringTag, ..)` answers false: the inherited property is read-only.
const m = new Map();
console.log(Reflect.set(m, Symbol.toStringTag, "x"), String(m));
