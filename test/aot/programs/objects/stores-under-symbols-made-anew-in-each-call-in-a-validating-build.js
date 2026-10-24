// A call of Symbol that runs more than once makes another symbol each time. An object with named fields gets a property under such a symbol: first, last, between two names, beside a name of its literal, in a loop, through a function that nobody can follow. As in plain Bun, and a validating build has nothing to find: the objects get no name but the symbols of that call.
function show(what, make) {
  const first = make(1), second = make(2);
  const symbols = Object.getOwnPropertySymbols(first), others = Object.getOwnPropertySymbols(second);
  console.log(what, symbols.length, symbols.map(String).join(), Object.keys(second).join(), symbols.map(s => first[s]).join(), symbols.some(s => others.includes(s)), symbols.some(s => s in second), first.missing, typeof first.toString);
}
show("between two names", i => { const key = Symbol("key"); const o = {}; o.name = i; o[key] = 2; o.last = 3; return o; });
show("first", i => { const key = Symbol("key"); const o = {}; o[key] = 2; o.name = i; return o; });
show("last", i => { const key = Symbol("key"); const o = {}; o.name = i; o[key] = 2; return o; });
show("alone", i => { const key = Symbol("key"); const o = {}; o[key] = i; return o; });
show("beside a name of the literal", i => { const key = Symbol("key"); const o = { name: i }; o[key] = 2; o.last = 3; return o; });
show("without a description", i => { const key = Symbol(); const o = {}; o.name = i; o[key] = 2; o.last = 3; return o; });
show("two calls", i => { const a = Symbol("a"), b = Symbol("b"); const o = { name: i }; o[a] = 1; o[b] = 2; return o; });
show("in a loop", i => { const o = { name: i }; for (let n = 0; n < 3; n++) o[Symbol("n" + n)] = n; return o; });
show("in the literal", i => { const key = Symbol("key"); return { name: i, [key]: 2, last: 3 }; });
show("in a class", i => { const key = Symbol("key"); class C { constructor() { this.name = i; this[key] = 2; } } return new C(); });
const outer = Symbol("outer");
show("beside a symbol that is made once", i => { const key = Symbol("key"); const o = { name: i }; o[outer] = 1; o[key] = 2; return o; });
const put = [(o, k, v) => { o[k] = v; }, (o, k, v) => { Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true }); }];
show("through a function out of a list", i => { const o = { name: i }; put[i % 2](o, Symbol("key"), 2); return o; });
show("read back, updated and deleted", i => { const key = Symbol("key"), gone = Symbol("gone"); const o = { name: i }; o[key] = 2; o[gone] = 3; o[key] += o[gone]; delete o[gone]; return o; });
