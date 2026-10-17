// An object that others inherit from is given a Proxy for its prototype: from then on a store at an index of any array may have to ask a prototype chain, and the engine changes the storage of every array that is alive. Among them are frozen arrays and the arrays that tagged templates get.
function tag(parts) { return parts; }
const literal = [1, 2, 3], strings = ["a", "b"], doubles = [1.5, 2.5], empty = [], holey = [1, , 3];
const frozen = Object.freeze([4, 5]), frozenStrings = Object.freeze(["x", "y"]), frozenDoubles = Object.freeze([0.5, 1.5]), frozenEmpty = Object.freeze([]), frozenObjects = Object.freeze([{ n: 1 }, { n: 2 }]);
const sealed = Object.seal([6, 7]), closed = Object.preventExtensions([8, 9]);
const kept = tag`tagged ${1} twice`;
function Foo() {}
const first = new Foo();
Object.setPrototypeOf(Foo.prototype, new Proxy({}, { get(target, key) { return typeof key === "string" ? "magic " + key : undefined; } }));
console.log(first.anything, literal[2], strings[1], doubles[1], empty.length, holey.length, 1 in holey);
console.log(frozen.join(), frozenStrings.join(), frozenDoubles.join(), frozenEmpty.length, frozenObjects.map(o => o.n).join(), sealed.join(), closed.join());
console.log(kept.join("|"), kept.raw.join("|"), Object.isFrozen(kept), Object.isFrozen(kept.raw), Object.isFrozen(frozen), Object.isFrozen(frozenObjects));
const attempt = (name, f) => { try { console.log(name, f()); } catch (e) { console.log(name, "throws", e.constructor.name); } };
attempt("a store into a frozen array:", () => { "use strict"; frozen[0] = 9; return frozen[0]; });
attempt("a push onto a frozen array:", () => frozen.push(1));
attempt("a store into the array of a template:", () => { "use strict"; kept[0] = "other"; return kept[0]; });
attempt("the length of a frozen array:", () => { "use strict"; frozenStrings.length = 0; return frozenStrings.length; });
attempt("a descriptor:", () => JSON.stringify(Object.getOwnPropertyDescriptor(frozenDoubles, 1)));
literal.push(4); strings[5] = "f"; doubles[0] = "no double"; empty[0] = 1; sealed[0] = 60;
console.log(literal.join(), strings.length, doubles.join(), empty.join(), sealed.join(), [7, 8, 9].map(x => x * 2).join(), Object.freeze([10, 11]).concat(frozen).join(), tag`again`[0]);
for (const x of frozen) console.log("of", x);
console.log([...frozenStrings, ...kept].join());
