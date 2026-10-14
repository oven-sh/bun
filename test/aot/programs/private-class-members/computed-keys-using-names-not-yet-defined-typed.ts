// A computed member key uses a private name of the class that is being defined, before that private member exists, with type annotations.
declare const console: { log(...a: unknown[]): void };
declare const JSON: { parse(s: string): any };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown) { console.log(label + ": " + said(f)); }
const o: any = JSON.parse("{}");
const log: string[] = [];
function note(s: string, v: string): string { log.push(s); return v; }
row("a field, in a method's key", () => { class C { [o.#f]() {} #f = 2; } return "made"; });
row("a field, in an accessor's key", () => { class C { get [o.#f]() { return 1; } #f = 2; } return "made"; });
row("a method, in a method's key", () => { class C { [o.#m()]() {} #m() { return "k"; } } return "made"; });
row("a getter, in a method's key", () => { class C { [o.#g]() {} get #g() { return "k"; } } return "made"; });
row("a setter, stored to in a key", () => { class C { [(o.#s = 1)]() {} set #s(v: number) {} } return "made"; });
row("in, ahead of the field", () => { class C { [(#f in o) + ""]() {} #f = 2; } return Object.getOwnPropertyNames(C.prototype).join(); });
row("in, ahead of the method", () => { class C { [(#m in o) + ""]() {} #m() {} } return Object.getOwnPropertyNames(C.prototype).join(); });
row("two keys around the declaration", () => { class C { [said(() => o.#f)]() {} #f = 2; [said(() => o.#f) + "2"]() {} } return Object.getOwnPropertyNames(C.prototype).join(); });
row("the keys keep their order", () => { log.length = 0; class C { [note("a", "a")]() {} #f = 2; [note("b", "b")]() {} #g = 3; static [note("c", "c")]() {} } return log.join(); });
row("an arrow made in a key, called later", () => { let read: any; class C { [(read = (x: any) => x.#f, "k")]() {} #f = 2; } return read(new C()) + " " + said(() => read({})); });
row("a class expression", () => { const K = class { [said(() => o.#f)]() {} #f = 2; }; return Object.getOwnPropertyNames(K.prototype).join(); });
function make(x: any) { return class C { [x ? said(() => x.#f) : "none"]() {} #f = "k"; }; }
row("an instance of another evaluation", () => Object.getOwnPropertyNames(make(new (make(null))()).prototype).join());
for (let i = 0; i < 2; i++) row("in a loop " + i, () => { class C { [said(() => o.#f) + i]() {} #f = 2; } return Object.getOwnPropertyNames(C.prototype).join(); });
class Top { [said(() => o.#f)]() {} #f = 2; static names() { return Object.getOwnPropertyNames(Top.prototype).join(); } }
row("at the top level", () => Top.names());
