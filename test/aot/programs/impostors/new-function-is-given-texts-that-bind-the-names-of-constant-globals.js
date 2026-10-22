// A literal text that binds `undefined`, `NaN` or `Infinity` itself (a parameter, a declaration, a `with` object) reads its own binding, not the global of that name.
console.log(new Function("with ({ undefined: 3 }) return undefined")());
console.log(new Function("o", "with (o) return [undefined, NaN, Infinity]")({ NaN: 4 }).join());
console.log(new Function("undefined = 5; return undefined")());
console.log(new Function("let Infinity = 6; return Infinity")());
console.log(new Function("return typeof undefined + typeof NaN + typeof Infinity")());
console.log(new Function("function undefined() {} return typeof undefined")());
console.log(new Function("try { throw 7 } catch (NaN) { return NaN }")());
console.log(new Function("return (({ undefined }) => undefined)({ undefined: 8 })")());
console.log(new Function("return globalThis.undefined === undefined && Object.is(globalThis.NaN, NaN)")());
console.log((0, eval)("var Infinity; Infinity"), (0, eval)("-Infinity"), (0, eval)("[undefined].length"));
