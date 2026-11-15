// A list that a built-in made for a class below Array, or a view for a class below Uint8Array: the getter `undefined` of that class gets it as `this` and writes a text into a field of numbers, which typed loops then sum.
class Arc { cap: number; constructor(cap: number) { this.cap = cap; } }
class Below extends Array<Arc> { get undefined(): number { (this[0] as unknown as { cap: unknown }).cap = "text"; return this.length; } }
const none: number[] = [];
function sum(arcs: Arc[]): unknown { let s = 0; for (let i = 0; i < arcs.length; i++) s += arcs[i]!.cap; return s; }
function look(arcs: Arc[]): string { const found: unknown = arcs[none.pop()!]; return String(found) + " " + String(sum(arcs)); }
console.log(look((Array.of as Function).call(Below, new Arc(1), new Arc(2)) as Arc[]));
console.log(look((Array.from as Function).call(Below, [new Arc(3), new Arc(4)]) as Arc[]));
console.log(look(Reflect.construct(Array, [new Arc(5), new Arc(6)], Below) as Arc[]));
console.log(look(Below.of(new Arc(7), new Arc(8))));
console.log(look(Below.of(new Arc(9), new Arc(10)).map(a => a)));
console.log(look(Below.of(new Arc(11), new Arc(12), new Arc(13)).slice(1)));
console.log(look(Below.of(new Arc(14)).concat([new Arc(15)])));
const plain = [new Arc(16), new Arc(17)]; (plain as unknown as { constructor: unknown }).constructor = { [Symbol.species]: Below };
console.log(look(plain.map(a => a)), look(plain.filter(a => a.cap > 0)), look(plain));
console.log(look([new Arc(18), new Arc(19)]));
