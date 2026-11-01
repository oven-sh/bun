// Object literals written under a type that has only an index signature: their keys, key order, prototypes, copies and ill-typed contents.
const out: string[] = [];
function say(what: string, ...parts: unknown[]): void { out.push(what + ": " + parts.map(String).join(" ")); }

interface Item { name: string; size: number }
class Box implements Item {
    name = "box";
    size = 3;
    volume(): number { return this.size ** 3; }
}
interface State { byId: Record<string, Item>; ids: string[]; count: number }
function createState(): State { return { byId: {}, ids: [], count: 0 }; }
function withItem(items: Record<string, Item>, id: string, item: Item): Record<string, Item> { return { ...items, [id]: item }; }
function count(values: { [key: string]: unknown }): number { return Object.keys(values).length; }
class Registry {
    static shared: Record<string, number> = { zero: 0 };
    items: Record<string, Item> = {};
    add(item: Item, labels: Record<string, string> = {}): this {
        this.items[item.name] = item;
        labels.added = item.name;
        Registry.shared[item.name] = Object.keys(labels).length;
        return this;
    }
}

{
    const byId: Record<string, Item> = {};
    for (let i = 0; i < 5; i++) byId["k" + i] = { name: "n" + i, size: i };
    byId["10"] = { name: "ten", size: 10 };
    byId[2] = { name: "two", size: 2 };
    say("filled by key", Object.keys(byId).join(), byId.k3.name, byId["10"].size, byId[2].name, byId.missing);
    say("an ordinary object", Object.getPrototypeOf(byId) === Object.prototype, Object.is(byId.constructor, Object), typeof byId.toString, "k1" in byId, "toString" in byId, Object.hasOwn(byId, "toString"), Object.prototype.toString.call(byId));
}
{
    const counts: Record<string, number> = { constructor: 1, toString: 2, hasOwnProperty: 3, valueOf: 4, __defineGetter__: 5 };
    say("named like built-ins", Object.keys(counts).join(), counts["constructor"], counts["toString"], JSON.stringify(counts));
    let thrown = "none";
    try { say("never", "" + counts); } catch (e) { thrown = (e as Error).constructor.name; }
    say("no conversion to a string", thrown, Object.hasOwn(counts, "hasOwnProperty"), Object.keys(counts).length);
}
{
    const base: Record<string, number> = { inherited: 7 };
    const derived: Record<string, unknown> = { __proto__: base, own: 1 };
    say("prototype from the literal", Object.getPrototypeOf(derived) === base, derived.inherited, Object.keys(derived).join(), "inherited" in derived, Object.hasOwn(derived, "__proto__"));
    const bare: Record<string, unknown> = { __proto__: null, a: 1 };
    say("no prototype", Object.getPrototypeOf(bare), "toString" in bare, Object.keys(bare).join(), bare.a);
    const ignored: Record<string, unknown> = { __proto__: 5, a: 1 };
    say("a primitive is no prototype", Object.getPrototypeOf(ignored) === Object.prototype, Object.keys(ignored).join());
    const __proto__ = 5;
    const shorthand: Record<string, unknown> = { __proto__ };
    const computed: Record<string, unknown> = { ["__proto__"]: 6 };
    say("own properties named __proto__", Object.hasOwn(shorthand, "__proto__"), shorthand["__proto__"], Object.hasOwn(computed, "__proto__"), Object.keys(computed).join(), Object.getPrototypeOf(computed) === Object.prototype);
    const stored: Record<string, unknown> = {};
    stored["__proto__"] = base;
    say("stored through the setter", Object.getPrototypeOf(stored) === base, Object.keys(stored).length, stored.inherited);
    const key = "__proto" + "__".slice(0);
    stored[key] = 3;
    say("a primitive stored through the setter", Object.getPrototypeOf(stored) === base, Object.keys(stored).length);
    bare[key] = base;
    say("stored without the setter", Object.getPrototypeOf(bare), Object.keys(bare).join(), bare[key] === base);
}
{
    const mixed: Record<string, string> = { b: "b", 2: "two", a: "a", "1": "one", "01": "zero one", [-1]: "minus", 1.5: "half", 4294967295: "too large", 4294967294: "largest index" };
    say("order of keys", Object.keys(mixed).join(), JSON.stringify(mixed));
    mixed[0] = "zero"; mixed.c = "c"; delete mixed.a; mixed.a = "again";
    say("order after changes", Object.keys(mixed).join(), Object.values(mixed).join());
    const repeated: Record<string, number> = { a: 1, b: 2, ["a" + ""]: 3 };
    say("a repeated key keeps its place", JSON.stringify(repeated));
}
{
    const tag = Symbol("tag");
    const tagged: Record<string | symbol, number> = { [tag]: 1, plain: 2, [Symbol.iterator]: 3, 0: 4 };
    say("symbols", Object.keys(tagged).join(), Object.getOwnPropertySymbols(tagged).map(String).join(), tagged[tag], tagged[Symbol.iterator], Reflect.ownKeys(tagged).map(String).join(), JSON.stringify(tagged));
    delete tagged[tag];
    say("symbol deleted", Object.getOwnPropertySymbols(tagged).length, tag in tagged, Symbol.iterator in tagged);
}
{
    let items: Record<string, Item> = {};
    const steps: Record<string, Item>[] = [items];
    for (let i = 0; i < 6; i++) {
        items = withItem(items, "id" + (i % 4), i % 2 ? new Box() : { name: "n" + i, size: i });
        steps.push(items);
    }
    say("copies", steps.map(step => Object.keys(step).join("+")).join(), JSON.stringify(items), steps[1] === steps[2]);
    const box = items.id1;
    say("an instance read back", box instanceof Box, box.name, box.size, box instanceof Box ? box.volume() : -1);

    let reads = 0;
    const source = { get computed() { return ++reads; }, plain: 1, [Symbol.for("s")]: 2 };
    Object.defineProperty(source, "hidden", { value: 3, enumerable: false });
    const copy: Record<string | symbol, number> = { before: 0, ...source, after: 4 };
    say("spread", Object.keys(copy).join(), copy.computed, copy.computed, reads, copy.hidden, copy[Symbol.for("s")], Object.getOwnPropertyDescriptor(copy, "computed")!.value);
    const absent: Record<string, number> | null = out.length < 0 ? {} : null;
    const letters: any = "ab";
    const spelled: Record<string, unknown> = { ...absent, ...letters, ...[7, 8, 9].slice(2) };
    say("spread of other values", JSON.stringify(spelled));
    const boxes: Record<string, Box> = { one: new Box() };
    const wider: Record<string, Item> = { ...boxes, ...{ two: new Box(), three: { name: "three", size: 0 } } };
    say("spread of narrower types", Object.keys(wider).map(id => id + "=" + wider[id].name + "/" + wider[id].size).join());
}
{
    const tree: Record<string, Record<string, number[]>> = { a: { x: [1, 2], y: [] }, b: {}, c: { z: [3] } };
    tree.b.late = [4];
    say("nested", JSON.stringify(tree), Object.keys(tree.b).join(), JSON.stringify(tree, ["a", "x"]), JSON.stringify(tree, null, 1).length);
    const replaced: Record<string, unknown> = { toJSON() { return { replaced: Object.keys(this).join() }; }, a: 1 };
    say("toJSON", JSON.stringify(replaced), JSON.stringify({ inner: replaced }));
    const parsed: Record<string, number> = JSON.parse('{"b":1,"a":2,"1":3,"__proto__":4}');
    const merged: Record<string, number> = { first: 0, ...parsed };
    say("parsed and merged", Object.keys(merged).join(), Object.hasOwn(merged, "__proto__"), merged["__proto__"], Object.getPrototypeOf(merged) === Object.prototype);
}
{
    type Operation = (n: number) => number;
    function negate(n: number): number { return -n; }
    const operations: Record<string, Operation> = { double(n) { return n * 2; }, square: n => n * n, ["cu" + "be"]: n => n ** 3, negate, chosen: out.length > 1000 ? negate : Math.abs };
    say("functions", Object.keys(operations).map(name => name + "=" + operations[name](-3) + "/" + operations[name].name).join());
    const parent: Record<string, () => string> = { who() { return "parent"; } };
    const child: Record<string, () => string> = { who() { return "child of " + super.who(); } };
    Object.setPrototypeOf(child, parent);
    say("super", child.who(), parent.who());
    let reads = 0;
    const lazy: Record<string, number> = { get once() { return ++reads; }, set once(value) { reads = value; }, plain: 1 };
    say("accessors", lazy.once, lazy.once, (lazy.once = 10), lazy.once, Object.keys(lazy).join(), typeof Object.getOwnPropertyDescriptor(lazy, "once")!.get);
}
{
    const byId: Record<string, Item> = { good: { name: "good", size: 1 } };
    const untyped: any = byId;
    untyped.number = 5; untyped.text = "text"; untyped.nothing = null; untyped.other = { size: "wide" }; untyped.list = [1, 2];
    const seen: string[] = [];
    for (const id in byId) {
        const item = byId[id];
        seen.push(id + "=" + (item == null ? "nil" : item.name + "/" + item.size));
    }
    say("contents that do not fit the type", seen.join());
    const wrong: any = { name: 1 };
    const held: Record<string, Item> = { wrong, [wrong.name]: wrong.name };
    say("members that do not fit the type", JSON.stringify(held), held.wrong.name, held[1]);
}
{
    const fixed: Record<string, number> = { a: 1, b: 2 };
    Object.defineProperty(fixed, "hidden", { value: 3, enumerable: false, configurable: true, writable: false });
    Object.freeze(fixed);
    const thrown: string[] = [];
    try { fixed.c = 4; } catch (e) { thrown.push((e as Error).constructor.name); }
    try { delete fixed.a; } catch (e) { thrown.push((e as Error).constructor.name); }
    say("frozen", thrown.join(), Object.isFrozen(fixed), Object.keys(fixed).join(), fixed.hidden, fixed.c);
    const above: Record<string, number> = { shared: 1, above: 2 };
    const below: Record<string, number> = { below: 3, shared: 4 };
    Object.setPrototypeOf(below, above);
    const seen: string[] = [];
    for (const key in below) seen.push(key + "=" + below[key]);
    say("for-in through a prototype", seen.join(), Object.entries(below).join(";"), JSON.stringify(Object.assign({}, below, above)));
}
{
    const first = createState(), second = createState();
    first.byId.a = { name: "a", size: 1 }; first.ids.push("a"); first.count++;
    say("a new dictionary each time", Object.keys(first.byId).join(), Object.keys(second.byId).length, first.byId === second.byId, JSON.stringify(second));
    const rows: Record<string, number>[] = [{}, { a: 1 }, {}];
    rows[0].x = 1; rows[2]["y" + rows.length] = 2;
    say("in an array", JSON.stringify(rows), rows[0] === rows[2]);
}
{
    const registry = new Registry().add(new Box()).add({ name: "plain", size: 1 }, { color: "red" });
    say("fields and parameters", Object.keys(registry.items).join(), JSON.stringify(Registry.shared), new Registry().items === registry.items);
    say("arguments and assertions", count({}), count({ a: 1, b: {} }), count({} as Record<string, Item>), count({ a: 1 } satisfies Record<string, number>), count(out.length ? { yes: 1 } : {}));
}
{
    const sparse: { [index: number]: string } = { 5: "five", 0: "zero" };
    sparse[2] = "two"; sparse[1e3] = "thousand";
    say("indexed by numbers", Object.keys(sparse).join(), sparse[5], sparse[3], JSON.stringify(sparse), Array.prototype.join.call({ length: 3, ...sparse }, "|"));
    const key = "k" + out.length;
    const own = { [key]: 1 };
    own.more = 2; own[key]++;
    say("a literal of computed keys", JSON.stringify(own), Object.keys(own).length);
}
{
    const many: Record<string, number> = { seed: -1 };
    for (let i = 0; i < 3000; i++) many["key" + i] = i;
    for (let i = 0; i < 3000; i += 3) delete many["key" + i];
    let sum = 0;
    for (const key in many) sum += many[key];
    say("many keys", Object.keys(many).length, sum, Object.keys(many).slice(0, 3).join(), Object.entries(many).pop()!.join("="));
    const squares: Record<string, number> = {
        w0: 0, w1: 1, w2: 4, w3: 9, w4: 16, w5: 25, w6: 36, w7: 49, w8: 64, w9: 81,
        w10: 100, w11: 121, w12: 144, w13: 169, w14: 196, w15: 225, w16: 256, w17: 289, w18: 324, w19: 361,
        w20: 400, w21: 441, w22: 484, w23: 529, w24: 576, w25: 625, w26: 676, w27: 729, w28: 784, w29: 841,
        w30: 900, w31: 961, w32: 1024, w33: 1089, w34: 1156, w35: 1225, w36: 1296, w37: 1369, w38: 1444, w39: 1521,
        w40: 1600, w41: 1681, w42: 1764, w43: 1849, w44: 1936, w45: 2025, w46: 2116, w47: 2209, w48: 2304, w49: 2401,
        w50: 2500, w51: 2601, w52: 2704, w53: 2809, w54: 2916, w55: 3025, w56: 3136, w57: 3249, w58: 3364, w59: 3481,
        w60: 3600, w61: 3721, w62: 3844, w63: 3969, w64: 4096, w65: 4225, w66: 4356, w67: 4489, w68: 4624, w69: 4761,
    };
    let total = 0;
    for (let i = 0; i < 80; i++) total += squares["w" + i] ?? -1;
    delete squares.w35; squares.w70 = 4900;
    say("a long literal", total, Object.keys(squares).length, Object.keys(squares)[35], Object.keys(squares).pop(), squares.w69);
}
console.log(out.join("\n"));
/* Output:
filled by key: 2,10,k0,k1,k2,k3,k4 n3 10 two undefined
an ordinary object: true true function true true false [object Object]
named like built-ins: constructor,toString,hasOwnProperty,valueOf,__defineGetter__ 1 2 {"constructor":1,"toString":2,"hasOwnProperty":3,"valueOf":4,"__defineGetter__":5}
no conversion to a string: TypeError true 5
prototype from the literal: true 7 own true false
no prototype: null false a 1
a primitive is no prototype: true a
own properties named __proto__: true 5 true __proto__ true
stored through the setter: true 0 7
a primitive stored through the setter: true 0
stored without the setter: null a,__proto__ true
order of keys: 1,2,4294967294,b,a,01,-1,1.5,4294967295 {"1":"one","2":"two","4294967294":"largest index","b":"b","a":"a","01":"zero one","-1":"minus","1.5":"half","4294967295":"too large"}
order after changes: 0,1,2,4294967294,b,01,-1,1.5,4294967295,c,a zero,one,two,largest index,b,zero one,minus,half,too large,c,again
a repeated key keeps its place: {"a":3,"b":2}
symbols: 0,plain Symbol(tag),Symbol(Symbol.iterator) 1 3 0,plain,Symbol(tag),Symbol(Symbol.iterator) {"0":4,"plain":2}
symbol deleted: 1 false true
copies: ,id0,id0+id1,id0+id1+id2,id0+id1+id2+id3,id0+id1+id2+id3,id0+id1+id2+id3 {"id0":{"name":"n4","size":4},"id1":{"name":"box","size":3},"id2":{"name":"n2","size":2},"id3":{"name":"box","size":3}} false
an instance read back: true box 3 27
spread: before,computed,plain,after 1 1 1 undefined 2 1
spread of other values: {"0":9,"1":"b"}
spread of narrower types: one=box/3,two=box/3,three=three/0
nested: {"a":{"x":[1,2],"y":[]},"b":{"late":[4]},"c":{"z":[3]}} late {"a":{"x":[1,2]}} 112
toJSON: {"replaced":"toJSON,a"} {"inner":{"replaced":"toJSON,a"}}
parsed and merged: 1,first,b,a,__proto__ true 4 true
functions: double=-6/double,square=9/square,cube=-27/cube,negate=3/negate,chosen=3/abs
super: child of parent parent
accessors: 1 2 10 11 once,plain function
contents that do not fit the type: good=good/1,number=undefined/undefined,text=undefined/undefined,nothing=nil,other=undefined/wide,list=undefined/undefined
members that do not fit the type: {"1":1,"wrong":{"name":1}} 1 1
frozen: TypeError,TypeError true a,b 3 undefined
for-in through a prototype: below=3,shared=4,above=2 below,3;shared,4 {"below":3,"shared":1,"above":2}
a new dictionary each time: a 0 false {"byId":{},"ids":[],"count":0}
in an array: [{"x":1},{"a":1},{"y3":2}] false
fields and parameters: box,plain {"zero":0,"box":1,"plain":2} false
arguments and assertions: 0 2 0 1 1
indexed by numbers: 0,2,5,1000 five undefined {"0":"zero","2":"two","5":"five","1000":"thousand"} zero||two
a literal of computed keys: {"k36":2,"more":2} 2
many keys: 2001 2999999 seed,key1,key2 key2999=2999
a long literal: 111885 70 w36 w70 4761
*/
