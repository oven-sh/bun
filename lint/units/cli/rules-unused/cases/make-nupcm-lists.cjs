// Research scratch of "rules-unused": the edge lists of no-unused-private-class-members. node make-nupcm-lists.cjs writes
// cases/nupcm-edge-js.json and cases/nupcm-edge-ts.json (arrays of { code, ext }).
"use strict";
const fs = require("fs");
const path = require("path");
const js = [];
const ts = [];
const cls = body => `class A { #x; ${body} }`;
const m = stmt => cls(`m() { ${stmt} }`);
// --- where the member stands: each once as a field and once as an accessor pair ---
const sites = [
	"this.#x;", "this.#x = 1;", "(this.#x) = 1;", "((this.#x)) = 1;", "this.#x += 1;", "(this.#x += 1);", "this.#x ||= 1;", "this.#x &&= 1;", "this.#x ??= 1;",
	"this.#x **= 2;", "this.#x++;", "++this.#x;", "this.#x--;", "--this.#x;", "(this.#x++);", "(this.#x)++;", "a, this.#x++;", "this.#x++, a;", "a = this.#x++;",
	"a = this.#x += 1;", "a = (this.#x = 1);", "this.#x = this.#x + 1;", "this.#x = a = 1;", "a = this.#x = 1;", "x(this.#x = 1);", "x(this.#x++);",
	"for (this.#x = 0;;) break;", "for (this.#x++;;) break;", "for (;; this.#x++) break;", "for (; this.#x++;) break;", "for (this.#x in o);", "for (this.#x of o);",
	"for ((this.#x) in o);", "for ([this.#x] of o);", "for ({ a: this.#x } of o);", "for (const k in this.#x);", "for (const k of this.#x);", "for (var k = this.#x;;) break;",
	"[this.#x] = o;", "[(this.#x)] = o;", "[this.#x = 1] = o;", "[a = this.#x] = o;", "[...this.#x] = o;", "[...[this.#x]] = o;", "[[this.#x]] = o;", "[, this.#x] = o;",
	"({ a: this.#x } = o);", "({ a: this.#x = 1 } = o);", "({ a: [this.#x] } = o);", "({ [this.#x]: a } = o);", "({ ...this.#x } = o);", "({ a: { b: this.#x } } = o);",
	"({ a = this.#x } = o);", "({ a: b = this.#x } = o);", "({ [this.#x]: this.#x } = o);",
	"[this.#x];", "({ a: this.#x });", "x(...this.#x);", "[...this.#x];", "({ ...this.#x });",
	"if (c) this.#x++;", "if (c) this.#x += 1; else this.#x -= 1;", "while (c) this.#x++;", "do this.#x++; while (c);", "l: this.#x++;", "{ this.#x++; }",
	"switch (c) { case 1: this.#x++; }", "try { this.#x++; } catch {}", "with (o) this.#x++;",
	"return this.#x++;", "throw this.#x++;", "void this.#x++;", "!this.#x++;", "this.#x++ + 1;", "c ? this.#x++ : 0;", "c && this.#x++;", "c && (this.#x = 1);", "c ? (this.#x = 1) : 0;",
	"(() => this.#x++)();", "(() => { this.#x++; })();", "(function () { this.#x++; }).call(this);", "() => (this.#x = 1);", "() => this.#x;",
	"delete this.#x;", "typeof this.#x;", "this.#x.y = 1;", "this.#x.y++;", "this.#x[0] = 1;", "this.#x();", "new this.#x();", "this.#x``;", "this.#x?.y;", "this?.#x;", "a?.b.#x;", "(a?.b).#x = 1;",
	"#x in this;", "(#x in this);", "a = #x in this;", "if (#x in o) {}", "#x in o ? 1 : 2;", "x(#x in o);",
	"o.#x = 1;", "o.p.#x = 1;", "f().#x = 1;", "o.#x;", "super.y = this.#x;", "this.#x = this;", "[this.#x, a] = [a, this.#x];", "this.#x = () => this.#x;",
	"`${this.#x}`;", "`${this.#x = 1}`;", "`${this.#x++}`;", "async function f() { await (this.#x = 1); }", "function* g() { yield this.#x++; }",
	"this.#x++\n;", "this.#x = 1\n", ";this.#x++", "this.#x++ ;", "'use strict'; this.#x++;",
];
for (const s of sites) {
	js.push(m(s));
	js.push(`class A { get #x() { return 1; } set #x(v) {} m() { ${s} } }`);
}
// --- what declares ---
js.push(
	"class A { #x; }", "class A { #x = 1; }", "class A { static #x; }", "class A { static #x = 1; }", "class A { #x() {} }", "class A { static #x() {} }", "class A { *#x() {} }",
	"class A { async #x() {} }", "class A { async *#x() {} }", "class A { get #x() { return 1; } }", "class A { set #x(v) {} }", "class A { static get #x() { return 1; } }",
	"class A { static set #x(v) {} }", "class A { get #x() { return 1; } set #x(v) {} }", "class A { set #x(v) {} get #x() { return 1; } }",
	"class A { static get #x() { return 1; } static set #x(v) {} }", "class A { #x; #y; #z; }", "class A { #x; #y; m() { this.#y; } }", "class A { #a; #b; m() { this.#a; this.#b = 1; } }",
	"class A {\n  #x;\n  #y = 1;\n  #z() {}\n}", "class A { #\\u0078; }", "class A { #x; m() { this.#\\u0078; } }", "class A { #\\u0078; m() { this.#x; } }", "class A { #π; }", "class A { #$; #_; }",
	"(class { #x; });", "x = class { #x; };", "x = class B { #x; };", "export class A { #x; }", "export default class { #x; }", "export default class A { #x; m() { return this.#x; } }",
	"class A { #x; static { this.#x; } }", "class A { static #x; static { A.#x = 1; } }", "class A { static #x; static { A.#x++; } }", "class A { static #x; static { x(A.#x); } }",
	"class A { #x; y = this.#x; }", "class A { #x; y = this.#x = 1; }", "class A { #x; y = (this.#x = 1); }", "class A { #x; y = this.#x++; }", "class A { #x; [this.#x] = 1; }", "class A { #x; [#x in o] = 1; }",
	"class A { #x = this.#y; #y = this.#x; }", "class A { #x = this.#x; }", "class A { #x() { this.#x(); } }", "class A { #x() { return this.#x; } }", "class A { get #x() { return this.#x; } }",
	"class A { set #x(v) { this.#x = v; } }", "class A { #x; constructor() { this.#x = 1; } }", "class A { #x; constructor(x = this.#x) {} }", "class A { #x; m(a = this.#x) {} }", "class A { #x; m(a = (this.#x = 1)) {} }",
);
// --- nested classes, heritage ---
js.push(
	"class A { #x; m() { return class { m() { return this.#x; } }; } }", "class A { #x; m() { return class { #x; m() { return this.#x; } }; } }", "class A { #x; m() { return class { #x; }; } }",
	"class A { #x; m() { return class { #y; m() { this.#x; this.#y; } }; } }", "class A { #x; m() { class B { #x; } return this.#x; } }", "class A { #x; m() { class B { #x; m() { this.#x = 1; } } return this.#x; } }",
	"class A { #x; static B = class extends (A.#x, Object) {}; }", "class A { #x; static B = class { #x; static C = class extends (this.#x, Object) {}; }; }",
	"class A { #x; m() { return class B extends (this.#x, Object) { #x; }; } }", "class A { #x; m() { return class B extends (this.#x = Object) { #x; m() { this.#x; } }; } }",
	"class A extends (class { #x; m() { this.#x; } }) { #x; }", "class A { #x; m() { return class { [this.#x]() {} }; } }", "class A { #x; m() { return class { #x; [this.#x]() {} }; } }",
	"class A { #x; m() { return class { static y = this.#x; }; } }", "class A { #x; m() { return class { #x; static y = this.#x; }; } }", "class A { #a; m() { return class { #b; m() { return class { m() { this.#a; this.#b; } }; } }; } }",
	"class A { #a; m() { return class { #a; m() { return class { m() { this.#a; } }; } }; } }", "class A { m() { this.#x; } #x; }", "class A { m() { this.#x = 1; } #x; }",
	"class A { #x; } class B { #x; m() { this.#x; } }", "class A { #x; m() { this.#x; } } class B { #x; }", "function f() { return class { #x; }; }", "const o = { m() { return class { #x; }; } };",
	"class A { #x; m() { const f = () => { this.#x = 1; }; } }", "class A { #x; m() { function f() { this.#x; } } }", "class A { #x; m() { return { get y() { return this.#x; } }; } }",
);
// --- TypeScript: what stands around the member and leaves no node, and members that leave none ---
const tsSites = [
	"this.#x! = 1;", "(this.#x!) = 1;", "(this.#x as any) = 1;", "(<any>this.#x) = 1;", "(this.#x satisfies any) = 1;", "this.#x!++;", "(this.#x as any)++;", "this.#x! += 1;",
	"(this.#x++) as any;", "(this.#x += 1) as any;", "(this.#x++)!;", "<any>this.#x++;", "(this.#x = 1) as any;", "(this.#x = 1)!;", "this.#x = 1 as any;", "this.#x = <any>1;",
	"[this.#x!] = o;", "[this.#x as any] = o;", "({ a: this.#x! } = o);", "({ a: this.#x as any } = o);", "[...this.#x!] = o;", "for (this.#x! of o);", "for ((this.#x as any) of o);",
	"([this.#x]) = o;", "([this.#x] as any) = o;", "[[this.#x] as any] = o;", "[([this.#x])] = o;", "({ a: ([this.#x]) } = o);", "(({ a: this.#x }) = o);", "(({ a: this.#x }) as any) = o;",
	"this.#x<string>;", "this.#x<string>();", "new this.#x<string>();", "this.#x!;", "this.#x as any;", "(this as any).#x = 1;", "(this as A).#x;", "this!.#x = 1;", "(<A>this).#x++;",
	"const a: typeof this.#x = 1;", "let a = this.#x!;", "this.#x = this.#x!;", "x(this.#x!);",
];
for (const s of tsSites) {
	ts.push(`class A { #x: any; m(o: any) { ${s} } }`);
	ts.push(`class A { get #x(): any { return 1; } set #x(v: any) {} m(o: any) { ${s} } }`);
}
for (const s of sites) ts.push(`class A { #x: any; m(this: any, a: any, o: any, c: any, x: any) { ${s} } }`);
ts.push(
	"class A { #m(a: string): void; #m(a: any) {} }", "class A { #m(a: string): void; #m(a: number): void; #m(a: any) {} m() { this.#m(1); } }", "class A { #m(a: any) {} #m(a: string): void; }",
	"class A { static #m(a: string): void; static #m(a: any) {} }", "class A { #m(a: string): void; }", "class A { get #x(): number; }", "class A { #m(a = this.#y): void; #m(a: any) {} #y = 1; }",
	"class A { accessor #x = 1; }", "class A { accessor #x = 1; m() { return this.#x; } }", "class A { static accessor #x = 1; }", "class A { #x = 1; m() { return class { accessor #x = 2; }; } }",
	"abstract class A { abstract #x: number; }", "abstract class A { abstract #m(): void; }", "abstract class A { abstract accessor #x: number; }", "abstract class A { #y = 1; abstract m(a?: number): void; }",
	"class A { declare #x: number; }", "class A { declare #x: number; m() { return this.#x; } }", "class A { declare static #x: number; }", "class A { #x?: number; }", "class A { #x!: number; }",
	"class A { readonly #x = 1; }", "class A { static readonly #x = 1; m() { return A.#x; } }", "class A { private y = 1; #x = 1; }", "class A { private y = 1; }", "class A { private static y = 1; }",
	"class A { constructor(private y: number) {} }", "class A { #x = 1; constructor(private y = this.#x) {} }",
	"declare class A { #x: number; }", "declare class A { #x: number; #m(): void; }", "declare class A { get #x(): number; set #x(v: number); }", "export declare class A { #x: number; }",
	"declare namespace N { class A { #x: number; } }", "namespace N { class A { #x = 1; } }", "namespace N { export class A { #x = 1; m() { return this.#x; } } }", "declare module 'm' { class A { #x: number; } }",
	"declare global { class A { #x: number; } } export {};", "namespace N.M { class A { #x = 1; } }", "export namespace N { declare class A { #x: number; } }",
	"class A<T> { #x: T; }", "class A<T> { #x!: T; m(): T { return this.#x; } }", "class A { #x = 1; m(): this is A { return #x in this; } }", "class A { #x = 1; [k: string]: any; }",
	"class A { #x = 1; m(o: A) { o.#x = 2; } }", "class A { #x = 1; m(o: A) { return o.#x; } }", "class A { #x = 1; static m(o: A): number { return o.#x; } }",
	"class A { @dec #x = 1; }", "class A { @dec #m() {} }", "class A { @(function (this: any) { return this.#x; }) y = 1; #x = 1; }", "@(class { #x = 1; }) class A {}",
	"class A { #x = 1; m() { enum E { a = this.#x } } }", "class A { #x = 1; m() { namespace N { export const a = 1; } return this.#x; } }", "class A { #x = 1; m = () => { this.#x! += 1; }; }",
	"interface I { x: number } class A implements I { x = 1; #y = 2; }", "type T = { a: number }; class A { #x: T = { a: 1 }; }", "class A { #x = 1 as const; }", "class A { #x = <any>1; m() { this.#x = 2 as any; } }",
	"function f(this: A) { } class A { #x = 1; }", "class A { #x = 1; m() { const self = this; self.#x = 2; } }", "class A { #x = 1; m() { const self = this; return self.#x; } }",
);
const wrap = list => list.map(code => ({ code, ext: "js" }));
fs.writeFileSync(path.join(__dirname, "nupcm-edge-js.json"), JSON.stringify(wrap(js), null, "\t") + "\n");
fs.writeFileSync(path.join(__dirname, "nupcm-edge-ts.json"), JSON.stringify(ts.map(code => ({ code, ext: "ts" })), null, "\t") + "\n");
console.log(js.length, ts.length);
