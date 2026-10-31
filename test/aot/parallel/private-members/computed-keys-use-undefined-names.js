// A computed member key uses a private name of the class that is being defined, before that private member exists.
function said(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
const other = JSON.parse("{}");
const log = [];
function note(s, v) { log.push(s); return v; }
row("a field, in a field's key", () => { class C { [other.#f] = 1; #f = 2; } return "made"; });
row("a field, in a method's key", () => { class C { [other.#f]() {} #f = 2; } return "made"; });
row("a field, in an accessor's key", () => { class C { get [other.#f]() { return 1; } #f = 2; } return "made"; });
row("a method, in a field's key", () => { class C { [other.#m()] = 1; #m() { return "k"; } } return "made"; });
row("a getter, in a field's key", () => { class C { [other.#g] = 1; get #g() { return "k"; } } return "made"; });
row("a setter, stored to in a key", () => { class C { [(other.#s = 1)] = 1; set #s(v) {} } return "made"; });
row("in, ahead of the field", () => { class C { [(#f in other) + ""] = 1; #f = 2; } return Object.keys(new C()).join(); });
row("in, ahead of the method", () => { class C { [(#m in other) + ""] = 1; #m() {} } return Object.keys(new C()).join(); });
row("in, of what is no object", () => { class C { [(#f in 1) + ""] = 1; #f = 2; } return "made"; });
row("null", () => { class C { [null.#f] = 1; #f = 2; } return "made"; });
row("two keys around the declaration", () => { class C { [said(() => other.#f)] = 1; #f = 2; [said(() => other.#f) + "2"] = 2; } return Object.keys(new C()).join(); });
row("the keys keep their order", () => { log.length = 0; class C { [note("a", "a")] = 1; #f = 2; [note("b", "b")]() {} #g = 3; static [note("c", "c")] = 4; } return log.join(); });
row("an arrow made in a key, called later", () => { let read; class C { [(read = (o) => o.#f, "k")] = 1; #f = 2; } return read(new C()) + " " + said(() => read({})); });
row("a class expression", () => { const K = class { [said(() => other.#f)] = 1; #f = 2; }; return Object.keys(new K()).join(); });
function make(o) { return class C { [o ? said(() => o.#f) : "none"] = 1; #f = "k"; }; }
row("an instance of another evaluation", () => Object.keys(new (make(new (make(null))()))()).join());
row("made twice, each its own name", () => { const A = make(null), B = make(null); return Object.keys(new A()).join() + Object.keys(new B()).join(); });
for (let i = 0; i < 2; i++) row("in a loop " + i, () => { class C { [said(() => other.#f) + i] = 1; #f = 2; } return Object.keys(new C()).join(); });
