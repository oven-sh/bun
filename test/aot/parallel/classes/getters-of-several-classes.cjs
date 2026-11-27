// STATISTIC: GettersCalledByClass >= 1
// Under: --aot-harden=proof-checks: the getter that a class calls is the one that the object finds
// Under: --aot-testing=FailSpeculations: each read runs as written
// Under: --aot-testing=CheckEffectsAtRunTime: the tests of shapes write nothing and run no code of the program
// A name is a getter of each class that a value may be of, and there are few getters in all. Getters replaced, deleted, hidden, that throw, beside a proxy, primitives and objects of other classes.
"use strict";
const R = globalThis[JSON.parse('"Reflect"')]; let asked = 0;
class Stored { constructor(name) { this.name = name; this.bytes = name.length; } }
class Holder extends Stored { constructor(name) { super(name); this.list = []; } get parts() { asked++; return this.list; } get weight() { return this.bytes + this.list.length; } }
class Single extends Stored { get parts() { return none; } get weight() { return this.bytes; } }
const none = [];
class Folder extends Holder { put(x) { this.list.push(x); return this; } }
class Archive extends Holder { constructor(name) { super(name); this.ratio = 2; } put(x) { this.list.unshift(x); return this; } }
class Paper extends Single { constructor(name) { super(name); this.pages = 3; } }
class Picture extends Single { constructor(name) { super(name); this.wide = 4; this.high = 5; } }
class Alias extends Single { constructor(name) { super(name); this.to = null; } }
function weigh(x) { let n = x.weight; const parts = x.parts; n = n * 3 + parts.length; return n; }
function names(x) { return x.name + "(" + x.parts.length + ")"; }
const classes = [Folder, Archive, Paper, Picture, Alias];
const make = (i, deep) => { const C = classes[i % classes.length], x = new C("n" + i % 11); if (x.put) for (let k = 0; k < i % 4 && deep > 0; k++) x.put(make(i + k + 1, deep - 1)); return x; };
const shown = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
const run = list => { let sum = 0; for (let i = 0; i < 300; i++) sum = (sum * 17 + weigh(list[i % list.length]) + names(list[(i * 3) % list.length]).length) | 0; return sum; };
const list = []; for (let i = 0; i < 25; i++) list.push(make(i, 2));
console.log("as made", run(list), asked);
Object.defineProperty(Single.prototype, "weight", { get() { return -this.bytes; }, configurable: true });
console.log("replaced", run(list), asked);
Object.defineProperty(Paper.prototype, "parts", { get() { return [1, 2]; }, configurable: true });
console.log("hidden by a class", run(list), asked);
delete Paper.prototype.parts;
console.log("taken away again", run(list), asked);
Object.defineProperty(list[3], "weight", { value: 1000, configurable: true });
Object.defineProperty(list[0], "parts", { get: () => [7, 7, 7], configurable: true });
console.log("hidden by objects", run(list), asked);
Object.defineProperty(Alias.prototype, "parts", { get() { throw new RangeError("no parts"); }, configurable: true });
console.log("throws", shown(() => run(list)), asked);
delete Alias.prototype.parts;
R.setPrototypeOf(Alias.prototype, { get parts() { return [9]; }, get weight() { return 2; } });
console.log("another prototype", shown(() => run(list)), asked);
let traps = 0;
const others = [{ name: "own", parts: [1], weight: 5 }, new Proxy(list[1], { get(t, k) { traps++; return R.get(t, k); } }), "text", 12, { name: "none" }, Object.create(list[2]), null, undefined, [1, 2], () => 1];
for (const o of others) console.log(shown(() => weigh(o)), shown(() => names(o)));
console.log(traps, asked, run(list.filter(x => !(x instanceof Holder))));
delete Holder.prototype.parts;
console.log("gone", shown(() => run(list)), asked);
