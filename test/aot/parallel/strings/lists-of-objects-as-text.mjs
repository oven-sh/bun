// Lists of objects as operands of +, templates and String(): conversions that change the list, throw, or ask for its text again.
let list = null, calls = 0;
class Name { constructor(s) { this.s = s; } toString() { calls++; return this.s; } }
class Changes extends Name { constructor(s, change) { super(s); this.change = change; } toString() { this.change?.(); return this.s; } }
class Primitive { constructor(v) { this.v = v; } [Symbol.toPrimitive](hint) { return typeof this.v === "function" ? this.v(hint) : this.v; } }
globalThis[["Na", "mes"].join("")] = { Name, Changes, Primitive };
const add = l => { try { return "t:" + l; } catch (e) { return e.constructor.name; } };
const addLeft = l => { try { return l + ":t"; } catch (e) { return e.constructor.name; } };
const template = l => { try { return `<${l}>`; } catch (e) { return e.constructor.name; } };
const text = l => { try { return String(l); } catch (e) { return e.constructor.name; } };
const show = make => console.log([add, addLeft, template, text].map(f => { list = make(); const r = f(list); return r + "/" + list.length; }).join(" "));
for (let turn = 0; turn < 3; turn++) {
    show(() => [new Name("a")]);
    show(() => [new Name("a"), new Name("b")]);
    show(() => [new Name("a"), 1, "t", null, undefined, true, new Name(""), 2.5]);
    show(() => Array.from({ length: 20 }, (_, i) => i % 3 ? new Name("n" + i) : i));
    show(() => [new Name("中"), new Name("\u{1F600}"), "é"]);
    show(() => [new Name(""), new Name("")]);
    show(() => [new Changes("a", () => list.push(new Name("new"))), new Name("b")]);
    show(() => [new Changes("a", () => list.pop()), new Name("b"), new Name("c")]);
    show(() => [new Changes("a", () => { list.length = 0; }), new Name("b")]);
    show(() => [new Changes("a", () => { list[1] = ["x", [5, null]]; }), new Name("b")]);
    show(() => [new Changes("a", () => { delete list[1]; }), new Name("b"), new Name("c")]);
    show(() => [new Changes("a", () => { list[1] = 0.5; list[0] = 1; }), new Name("b")]);
    show(() => [new Changes("a", () => { list[1] = Symbol("s"); }), new Name("b")]);
    show(() => [new Changes("a", () => { Object.freeze(list); }), new Name("b")]);
    show(() => [new Changes("a", () => { throw new RangeError("t"); }), new Name("b")]);
    show(() => [new Name("a"), new Primitive(5), new Primitive(null), new Primitive(h => h)]);
    show(() => [new Name("a"), new Primitive(Symbol("s"))]);
    show(() => [new Name("a"), new Primitive({})]);
    show(() => { const l = [new Changes("a", () => { l[1].s = "<" + l + ">"; }), new Name("b")]; return l; });
    show(() => { const l = [1, new Name("a")]; l.push(l); return l; });
    show(() => { const l = [new Changes("a", () => Bun.gc(true)), new Name("b".repeat(50)), new Name("c")]; return l; });
}
console.log(calls);
const frames = [];
class Framed extends Name { toString() { frames.push(/ join | at join/.test(new Error("e").stack)); return this.s; } }
const framed = [new Framed("a"), new Framed("b")];
console.log(add(framed), template(framed), text(framed), framed.join(), framed.toString(), framed.join(";"), frames.length, frames.slice(-6).join());
const held = {};
held[[new Name("a"), new Name("b")]] = 1;
console.log(Object.keys(held).join("|"), [new Name("a")] == "a", "a,b" == [new Name("a"), new Name("b")], [new Name("2")] * 3, [new Name("1"), new Name("2")] + [new Name("3")]);
class Names extends Array { }
console.log(add(Names.of(new Name("a"), new Name("b"))), text(Object.assign([new Name("a")], { toString() { return "own"; } })), text(Object.assign([new Name("a"), 1], { join() { return "joined"; } })));
