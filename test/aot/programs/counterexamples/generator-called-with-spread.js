// `g(...[]) instanceof g` for a generator function that is declared inside a function.
console.log((() => { function* g() {} return g(...[]) instanceof g; })());
