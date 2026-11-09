// The programs of private-class-members that are mostly a loop written out: thousands of fields, variables or functions that differ in a number. And those that are another program without its types.
import { family, programsOf, text, untypedTwins } from "../generate";

const written = {
  "uninitialized-members-in-function.ts": text(
    `// Code that runs during a class's static initialization observes private members that are not initialized yet, in classes created inside a function.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown): void { console.log(label + ": " + said(f)); }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

let seen = "", leak: () => string = () => "no leak";
function peek(): any { seen += "[" + leak() + "]"; return 1; }
class Peeker { constructor() { peek(); } }
const globalMap = Map;
const peeking: any = { [Symbol.iterator]() { peek(); return [][Symbol.iterator](); } };
const withGetter: any = { get g() { return peek(); } };
const withSetter: any = { set s(v: number) { peek(); } };
const withToString: any = { toString() { peek(); return "s"; } };
const withValueOf: any = { valueOf() { peek(); return 1; } };
const proxied: any = new Proxy({}, { get() { return peek(); }, has() { peek(); return true; } });
const hasInstance: any = { [Symbol.hasInstance]() { peek(); return true; } };
function tag(s: TemplateStringsArray) { return peek(); }
const one: number = 1, nothing: any = null;`,
    [
      `peek(	a call
(peek(), 1	a call in a comma
new Peeker(	new of a class of the program`,
      (n, a, b) => `function f${n}() {
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = ${a});
      static #after = 1;
      static report = leak();
    }
    console.log("made ${b}: " + seen + " | " + C.report);
}
f${n}(); f${n}();`,
    ],
    `function f3() {
    seen = "";
    class Map { constructor() { peek(); } }`,
    [
      ` = new Map()	new Map of the program	new globalMap(peeking)	new Map with an argument
 = { [peek()]: 1 }	a computed name	{ ...withGetter }	a spread object
 = [...peeking]	a spread array	[1, peek()]	an element
 = { a: { b: peek() } }	a value in a literal	\`\${withToString}\`	a template
 = -withValueOf	minus of an object	+withValueOf	plus of an object
 = 1 + withValueOf	a sum	tag\`x\`	a tag
 = (() => peek())()	an iife	class { static { peek(); } }	a class with a static block
 = class { static x = peek(); }	a class with a static field	class { [peek()]() {} }	a class with a computed name
 = class extends (peek(), Object) {}	a class with a heritage	withGetter.g	a getter read
 = proxied[0]	an element read	"x" in proxied	in
 = withGetter instanceof hasInstance	instanceof	one ? peek() : 0	a conditional
 = one && peek()	a logical	nothing ?? peek()	nullish
 = withSetter.s = 1	an assignment	typeof peek()	typeof a call
 = void peek()	void a call	peek?.()	an optional call
	nothing	null	null
 = true	true	5	a number
 = -5	minus a number	"s"	a string
 = 5n	a bigint	() => peek()	an arrow
 = function () { return peek(); }	a function	async () => peek()	an async arrow
 = function* () { yield peek(); }	a generator function	[1, , "a", [null], () => peek()]	an array
 = { a: 1, "b c": [2], 3: null, m() { return peek(); }, get g() { return peek(); }, set g(v) { peek(); }, __proto__: null }	an object	new Map()	new Map
 = new Set()	new Set	new WeakMap()	new WeakMap`,
      (n, a, b, c, d) => `    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any${a};
      static #after = 1;
      static report = leak();
    }
    console.log("made ${b}: " + seen + " | " + C.report);
}
f${2 * n + 3}(); f${2 * n + 3}();
function f${2 * n + 4}() {
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = ${c};
      static #after = 1;
      static report = leak();
    }
    console.log("made ${d}: " + seen + " | " + C.report);
}
f${2 * n + 4}(); f${2 * n + 4}();
function f${2 * n + 5}() {
    seen = "";`,
    ],
    `    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = new WeakSet;
      static #after = 1;
      static report = leak();
    }
    console.log("made new WeakSet: " + seen + " | " + C.report);
}
f47(); f47();
`,
  ),
  "uninitialized-members-top-level.ts": text(
    `// Code that runs during a class's static initialization observes private members that are not initialized yet, in classes at the top level.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown): void { console.log(label + ": " + said(f)); }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

let seen = "", leak: () => string = () => "no leak";
function peek(): any { seen += "[" + leak() + "]"; return 1; }
class Peeker { constructor() { peek(); } }
const globalMap = Map;
const peeking: any = { [Symbol.iterator]() { peek(); return [][Symbol.iterator](); } };
const withGetter: any = { get g() { return peek(); } };
const withSetter: any = { set s(v: number) { peek(); } };
const withToString: any = { toString() { peek(); return "s"; } };
const withValueOf: any = { valueOf() { peek(); return 1; } };
const proxied: any = new Proxy({}, { get() { return peek(); }, has() { peek(); return true; } });
const hasInstance: any = { [Symbol.hasInstance]() { peek(); return true; } };
function tag(s: TemplateStringsArray) { return peek(); }
const one: number = 1, nothing: any = null;`,
    [
      `peek(	a call
(peek(), 1	a call in a comma
new Peeker(	new of a class of the program`,
      (n, a, b) => `{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = ${a});
      static #after = 1;
      static report = leak();
    }
    console.log("top ${b}: " + seen + " | " + C.report);
}`,
    ],
    `{
    seen = "";
    class Map { constructor() { peek(); } }`,
    [
      ` = new Map()	new Map of the program	new globalMap(peeking)	new Map with an argument
 = { [peek()]: 1 }	a computed name	{ ...withGetter }	a spread object
 = [...peeking]	a spread array	[1, peek()]	an element
 = { a: { b: peek() } }	a value in a literal	\`\${withToString}\`	a template
 = -withValueOf	minus of an object	+withValueOf	plus of an object
 = 1 + withValueOf	a sum	tag\`x\`	a tag
 = (() => peek())()	an iife	class { static { peek(); } }	a class with a static block
 = class { static x = peek(); }	a class with a static field	class { [peek()]() {} }	a class with a computed name
 = class extends (peek(), Object) {}	a class with a heritage	withGetter.g	a getter read
 = proxied[0]	an element read	"x" in proxied	in
 = withGetter instanceof hasInstance	instanceof	one ? peek() : 0	a conditional
 = one && peek()	a logical	nothing ?? peek()	nullish
 = withSetter.s = 1	an assignment	typeof peek()	typeof a call
 = void peek()	void a call	peek?.()	an optional call
	nothing	null	null
 = true	true	5	a number
 = -5	minus a number	"s"	a string
 = 5n	a bigint	() => peek()	an arrow
 = function () { return peek(); }	a function	async () => peek()	an async arrow
 = function* () { yield peek(); }	a generator function	[1, , "a", [null], () => peek()]	an array
 = { a: 1, "b c": [2], 3: null, m() { return peek(); }, get g() { return peek(); }, set g(v) { peek(); }, __proto__: null }	an object	new Map()	new Map
 = new Set()	new Set	new WeakMap()	new WeakMap`,
      (n, a, b, c, d) => `    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any${a};
      static #after = 1;
      static report = leak();
    }
    console.log("top ${b}: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = ${c};
      static #after = 1;
      static report = leak();
    }
    console.log("top ${d}: " + seen + " | " + C.report);
}
{
    seen = "";`,
    ],
    `    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = new WeakSet;
      static #after = 1;
      static report = leak();
    }
    console.log("top new WeakSet: " + seen + " | " + C.report);
}
`,
  ),
};

export const programs = () =>
  programsOf({
    ...family(
      `method-identity-class-expression-in-function-no-capture-untyped.js	a class expression in a function and captures nothing	function	7		n", make(1), 
method-identity-class-expression-in-function-with-capture-untyped.js	a class expression in a function and captures a variable	function	n		c", make(1), 
method-identity-in-method-no-capture-untyped.js	declared in a method and captures nothing	const maker = {	7	 };	n", maker.make(1), maker.
method-identity-in-method-with-capture-untyped.js	declared in a method and captures a variable	const maker = {	n	 };	c", maker.make(1), maker.`,
      (
        a,
        b,
        c,
        d,
        e,
      ) => `// A private method is the same function object every time it is read: the class is ${a} (the same program without type annotations).
function said(f) { try { return String(f()); } catch (e) { return "threw " + (e).name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
const collect = (globalThis).gc ?? (() => (globalThis).Bun.gc(true));

const ways = ["viaThis", "viaArrow", "viaFunction", "viaDefault", "viaTry", "viaLoop", "viaCond", "viaInner", "viaLiteral", "viaArray", "viaSpread", "viaTemplate", "viaComma", "viaChain", "viaParen", "viaNullish", "viaAssign", "viaPattern", "viaHeritage", "viaKeyOfInner", "viaLiteralMethod", "viaLiteralGetter", "viaCatch", "viaRest", "viaFieldOfInner", "viaStaticBlockOfInner", "viaDeepArrows", "viaSwitch", "viaLabel"];
function check(label, A, B) {
  const f = A.m();
  for (const way of ways) row(label + " " + way, () => A[way]() === f);
  row(label + " viaGetter", () => A.viaGetter === f);
  row(label + " viaGenerator", () => A.viaGenerator().next().value === f);
  row(label + " viaInstance", () => new A().viaInstance() === f && new A().field === f);
  row(label + " early", () => A.early === f && A.viaNullishEarly === f);
  row(label + " same", () => A.same());
  row(label + " sameInlined", () => A.sameInlined());
  row(label + " called", () => f());
  row(label + " what it is", () => f.name + " " + f.length + " " + typeof f + " " + ("prototype" in f));
  row(label + " no constructor", () => new f());
  row(label + " kinds", () => [A.a() === A.a(), A.g() === A.g(), A.ag() === A.ag(), A.a() === A.m(), A.g() === A.ag()].join());
  row(label + " kinds run", () => [A.g()().next().value, typeof A.a()().then, typeof A.ag()().next].join());
  row(label + " mark", () => { f.mark = label; return A.viaThis().mark; });
  row(label + " mark behind a collection", () => { collect(); return A.viaArrow().mark; });
  row(label + " set", () => { const s = new Set(); s.add(A.m()); s.add(A.viaThis()); const n = s.size; s.delete(A.viaArrow()); return n + " " + s.size; });
  row(label + " weak map", () => { const w = new WeakMap(); w.set(A.m(), 5); return w.get(A.viaTry()); });
  row(label + " index", () => [A.a(), A.m(), A.g()].indexOf(A.viaLoop()));
  row(label + " switch", () => { switch (A.m()) { case A.a(): return "a"; case A.viaChain(): return "m"; default: return "none"; } });
  row(label + " its generator's prototype is kept", () => A.g().prototype === A.g().prototype);
  if (!B) return;
  row(label + " another evaluation", () => A.m() === B.m());
  row(label + " another evaluation's kinds", () => [A.a() === B.a(), A.g() === B.g(), A.ag() === B.ag()].join());
  row(label + " another evaluation called", () => B.m()() + " " + A.m()());
  row(label + " another evaluation's mark", () => B.m().mark);
  row(label + " two in a set", () => new Set([A.m(), B.m(), A.viaThis(), B.viaThis()]).size);
}
${b} make(n) { return class P {
    static #m() { return ${c}; }
    static async #a() { return ${c}; }
    static *#g() { yield ${c}; }
    static async *#ag() { yield ${c}; }
    static m() { return P.#m; }
    static viaThis() { return this.#m; }
    static viaArrow() { return (() => P.#m)(); }
    static viaFunction() { return (function () { return P.#m; })(); }
    static get viaGetter() { return P.#m; }
    static viaDefault(f = P.#m) { return f; }
    static viaTry() { try { return P.#m; } finally { } }
    static viaLoop() { let f; for (let i = 0; i < 3; i++) f = P.#m; return f; }
    static viaCond(c) { return c ? P.#m : P.#m; }
    static *viaGenerator() { yield P.#m; }
    static viaInner() { return class Q { static q() { return P.#m; } }.q(); }
    static viaLiteral() { return { f: P.#m }.f; }
    static viaArray() { return [P.#m][0]; }
    static viaSpread() { return [...[P.#m]][0]; }
    static viaTemplate() { return ((s, f) => f)\`\${P.#m}\`; }
    static viaComma() { return (P.name, P.#m); }
    static viaChain() { return P?.#m; }
    static viaParen() { return (P).#m; }
    static viaNullish() { return P.early ?? P.#m; }
    static viaAssign() { let f; f = P.#m; return f; }
    static viaPattern() { const { f } = { f: P.#m }; return f; }
    static viaHeritage() { let f; class X extends (f = P.#m, Object) {} return f; }
    static viaKeyOfInner() { let f; class X { [(f = P.#m, "k")]() {} } return f; }
    static viaLiteralMethod() { return { m() { return P.#m; } }.m(); }
    static viaLiteralGetter() { return { get g() { return P.#m; } }.g; }
    static viaCatch() { try { throw 0; } catch { return P.#m; } }
    static viaRest(...a) { return [P.#m, ...a][0]; }
    static viaFieldOfInner() { return new (class { v = P.#m; })().v; }
    static viaStaticBlockOfInner() { let f; class X { static { f = P.#m; } } return f; }
    static viaDeepArrows() { return (() => () => () => P.#m)()()(); }
    static viaSwitch(k = 1) { switch (k) { case 1: return P.#m; default: return undefined; } }
    static viaLabel() { out: { if (P.name !== undefined) break out; return undefined; } return P.#m; }
    field = P.#m;
    viaInstance() { return P.#m; }
    static early = undefined;
    static viaNullishEarly = P.viaNullish();
    static { P.early = P.#m; }
    static same() { return P.#m === P.#m; }
    static sameInlined() { return P.m() === P.m(); }
    static a() { return P.#a; }
    static g() { return P.#g; }
    static ag() { return P.#ag; }
}; }${d}
check("${e}make(2));`,
    ),
    ...family(
      `method-identity-top-level-block-no-capture-untyped.js	in a block at the top level and captures nothing	{ 	7	n", P, null); }
method-identity-top-level-block-with-capture-untyped.js	in a block at the top level and captures a variable	{ 	n	c", P, null); }
method-identity-top-level-class-no-capture-untyped.js	at the top level and captures nothing		7	n", P, null);`,
      (
        a,
        b,
        c,
        d,
      ) => `// A private method is the same function object every time it is read: the class is declared ${a} (the same program without type annotations).
function said(f) { try { return String(f()); } catch (e) { return "threw " + (e).name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
const collect = (globalThis).gc ?? (() => (globalThis).Bun.gc(true));

const ways = ["viaThis", "viaArrow", "viaFunction", "viaDefault", "viaTry", "viaLoop", "viaCond", "viaInner", "viaLiteral", "viaArray", "viaSpread", "viaTemplate", "viaComma", "viaChain", "viaParen", "viaNullish", "viaAssign", "viaPattern", "viaHeritage", "viaKeyOfInner", "viaLiteralMethod", "viaLiteralGetter", "viaCatch", "viaRest", "viaFieldOfInner", "viaStaticBlockOfInner", "viaDeepArrows", "viaSwitch", "viaLabel"];
function check(label, A, B) {
  const f = A.m();
  for (const way of ways) row(label + " " + way, () => A[way]() === f);
  row(label + " viaGetter", () => A.viaGetter === f);
  row(label + " viaGenerator", () => A.viaGenerator().next().value === f);
  row(label + " viaInstance", () => new A().viaInstance() === f && new A().field === f);
  row(label + " early", () => A.early === f && A.viaNullishEarly === f);
  row(label + " same", () => A.same());
  row(label + " sameInlined", () => A.sameInlined());
  row(label + " called", () => f());
  row(label + " what it is", () => f.name + " " + f.length + " " + typeof f + " " + ("prototype" in f));
  row(label + " no constructor", () => new f());
  row(label + " kinds", () => [A.a() === A.a(), A.g() === A.g(), A.ag() === A.ag(), A.a() === A.m(), A.g() === A.ag()].join());
  row(label + " kinds run", () => [A.g()().next().value, typeof A.a()().then, typeof A.ag()().next].join());
  row(label + " mark", () => { f.mark = label; return A.viaThis().mark; });
  row(label + " mark behind a collection", () => { collect(); return A.viaArrow().mark; });
  row(label + " set", () => { const s = new Set(); s.add(A.m()); s.add(A.viaThis()); const n = s.size; s.delete(A.viaArrow()); return n + " " + s.size; });
  row(label + " weak map", () => { const w = new WeakMap(); w.set(A.m(), 5); return w.get(A.viaTry()); });
  row(label + " index", () => [A.a(), A.m(), A.g()].indexOf(A.viaLoop()));
  row(label + " switch", () => { switch (A.m()) { case A.a(): return "a"; case A.viaChain(): return "m"; default: return "none"; } });
  row(label + " its generator's prototype is kept", () => A.g().prototype === A.g().prototype);
  if (!B) return;
  row(label + " another evaluation", () => A.m() === B.m());
  row(label + " another evaluation's kinds", () => [A.a() === B.a(), A.g() === B.g(), A.ag() === B.ag()].join());
  row(label + " another evaluation called", () => B.m()() + " " + A.m()());
  row(label + " another evaluation's mark", () => B.m().mark);
  row(label + " two in a set", () => new Set([A.m(), B.m(), A.viaThis(), B.viaThis()]).size);
}
${b}const n = 1;
class P {
    static #m() { return ${c}; }
    static async #a() { return ${c}; }
    static *#g() { yield ${c}; }
    static async *#ag() { yield ${c}; }
    static m() { return P.#m; }
    static viaThis() { return this.#m; }
    static viaArrow() { return (() => P.#m)(); }
    static viaFunction() { return (function () { return P.#m; })(); }
    static get viaGetter() { return P.#m; }
    static viaDefault(f = P.#m) { return f; }
    static viaTry() { try { return P.#m; } finally { } }
    static viaLoop() { let f; for (let i = 0; i < 3; i++) f = P.#m; return f; }
    static viaCond(c) { return c ? P.#m : P.#m; }
    static *viaGenerator() { yield P.#m; }
    static viaInner() { return class Q { static q() { return P.#m; } }.q(); }
    static viaLiteral() { return { f: P.#m }.f; }
    static viaArray() { return [P.#m][0]; }
    static viaSpread() { return [...[P.#m]][0]; }
    static viaTemplate() { return ((s, f) => f)\`\${P.#m}\`; }
    static viaComma() { return (P.name, P.#m); }
    static viaChain() { return P?.#m; }
    static viaParen() { return (P).#m; }
    static viaNullish() { return P.early ?? P.#m; }
    static viaAssign() { let f; f = P.#m; return f; }
    static viaPattern() { const { f } = { f: P.#m }; return f; }
    static viaHeritage() { let f; class X extends (f = P.#m, Object) {} return f; }
    static viaKeyOfInner() { let f; class X { [(f = P.#m, "k")]() {} } return f; }
    static viaLiteralMethod() { return { m() { return P.#m; } }.m(); }
    static viaLiteralGetter() { return { get g() { return P.#m; } }.g; }
    static viaCatch() { try { throw 0; } catch { return P.#m; } }
    static viaRest(...a) { return [P.#m, ...a][0]; }
    static viaFieldOfInner() { return new (class { v = P.#m; })().v; }
    static viaStaticBlockOfInner() { let f; class X { static { f = P.#m; } } return f; }
    static viaDeepArrows() { return (() => () => () => P.#m)()()(); }
    static viaSwitch(k = 1) { switch (k) { case 1: return P.#m; default: return undefined; } }
    static viaLabel() { out: { if (P.name !== undefined) break out; return undefined; } return P.#m; }
    field = P.#m;
    viaInstance() { return P.#m; }
    static early = undefined;
    static viaNullishEarly = P.viaNullish();
    static { P.early = P.#m; }
    static same() { return P.#m === P.#m; }
    static sameInlined() { return P.m() === P.m(); }
    static a() { return P.#a; }
    static g() { return P.#g; }
    static ag() { return P.#ag; }
}
check("${d}`,
    ),
    ...family(
      `method-identity-class-expression-in-function-no-capture.ts	a class expression in a function and captures nothing	function	7		n", make(1), 
method-identity-class-expression-in-function-with-capture.ts	a class expression in a function and captures a variable	function	n		c", make(1), 
method-identity-in-method-no-capture.ts	declared in a method and captures nothing	const maker = {	7	 };	n", maker.make(1), maker.
method-identity-in-method-with-capture.ts	declared in a method and captures a variable	const maker = {	n	 };	c", maker.make(1), maker.`,
      (a, b, c, d, e) => `// A private method is the same function object every time it is read: the class is ${a}.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown): void { console.log(label + ": " + said(f)); }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

const ways = ["viaThis", "viaArrow", "viaFunction", "viaDefault", "viaTry", "viaLoop", "viaCond", "viaInner", "viaLiteral", "viaArray", "viaSpread", "viaTemplate", "viaComma", "viaChain", "viaParen", "viaNullish", "viaAssign", "viaPattern", "viaHeritage", "viaKeyOfInner", "viaLiteralMethod", "viaLiteralGetter", "viaCatch", "viaRest", "viaFieldOfInner", "viaStaticBlockOfInner", "viaDeepArrows", "viaSwitch", "viaLabel"];
function check(label: string, A: any, B: any) {
  const f = A.m();
  for (const way of ways) row(label + " " + way, () => A[way]() === f);
  row(label + " viaGetter", () => A.viaGetter === f);
  row(label + " viaGenerator", () => A.viaGenerator().next().value === f);
  row(label + " viaInstance", () => new A().viaInstance() === f && new A().field === f);
  row(label + " early", () => A.early === f && A.viaNullishEarly === f);
  row(label + " same", () => A.same());
  row(label + " sameInlined", () => A.sameInlined());
  row(label + " called", () => f());
  row(label + " what it is", () => f.name + " " + f.length + " " + typeof f + " " + ("prototype" in f));
  row(label + " no constructor", () => new f());
  row(label + " kinds", () => [A.a() === A.a(), A.g() === A.g(), A.ag() === A.ag(), A.a() === A.m(), A.g() === A.ag()].join());
  row(label + " kinds run", () => [A.g()().next().value, typeof A.a()().then, typeof A.ag()().next].join());
  row(label + " mark", () => { f.mark = label; return A.viaThis().mark; });
  row(label + " mark behind a collection", () => { collect(); return A.viaArrow().mark; });
  row(label + " set", () => { const s = new Set(); s.add(A.m()); s.add(A.viaThis()); const n = s.size; s.delete(A.viaArrow()); return n + " " + s.size; });
  row(label + " weak map", () => { const w = new WeakMap(); w.set(A.m(), 5); return w.get(A.viaTry()); });
  row(label + " index", () => [A.a(), A.m(), A.g()].indexOf(A.viaLoop()));
  row(label + " switch", () => { switch (A.m()) { case A.a(): return "a"; case A.viaChain(): return "m"; default: return "none"; } });
  row(label + " its generator's prototype is kept", () => A.g().prototype === A.g().prototype);
  if (!B) return;
  row(label + " another evaluation", () => A.m() === B.m());
  row(label + " another evaluation's kinds", () => [A.a() === B.a(), A.g() === B.g(), A.ag() === B.ag()].join());
  row(label + " another evaluation called", () => B.m()() + " " + A.m()());
  row(label + " another evaluation's mark", () => B.m().mark);
  row(label + " two in a set", () => new Set([A.m(), B.m(), A.viaThis(), B.viaThis()]).size);
}
${b} make(n: number) { return class P {
    static #m() { return ${c}; }
    static async #a() { return ${c}; }
    static *#g() { yield ${c}; }
    static async *#ag() { yield ${c}; }
    static m() { return P.#m; }
    static viaThis() { return this.#m; }
    static viaArrow() { return (() => P.#m)(); }
    static viaFunction() { return (function () { return P.#m; })(); }
    static get viaGetter() { return P.#m; }
    static viaDefault(f = P.#m) { return f; }
    static viaTry() { try { return P.#m; } finally { } }
    static viaLoop() { let f; for (let i = 0; i < 3; i++) f = P.#m; return f; }
    static viaCond(c?: boolean) { return c ? P.#m : P.#m; }
    static *viaGenerator() { yield P.#m; }
    static viaInner() { return class Q { static q() { return P.#m; } }.q(); }
    static viaLiteral() { return { f: P.#m }.f; }
    static viaArray() { return [P.#m][0]; }
    static viaSpread() { return [...[P.#m]][0]; }
    static viaTemplate() { return ((s: TemplateStringsArray, f: unknown) => f)\`\${P.#m}\`; }
    static viaComma() { return (P.name, P.#m); }
    static viaChain() { return P.#m; }
    static viaParen() { return (P).#m; }
    static viaNullish() { return P.early ?? P.#m; }
    static viaAssign() { let f; f = P.#m; return f; }
    static viaPattern() { const { f } = { f: P.#m }; return f; }
    static viaHeritage() { let f; class X extends (f = P.#m, Object) {} return f; }
    static viaKeyOfInner() { let f; class X { [(f = P.#m, "k")]() {} } return f; }
    static viaLiteralMethod() { return { m() { return P.#m; } }.m(); }
    static viaLiteralGetter() { return { get g() { return P.#m; } }.g; }
    static viaCatch() { try { throw 0; } catch { return P.#m; } }
    static viaRest(...a: unknown[]) { return [P.#m, ...a][0]; }
    static viaFieldOfInner() { return new (class { v = P.#m; })().v; }
    static viaStaticBlockOfInner() { let f; class X { static { f = P.#m; } } return f; }
    static viaDeepArrows() { return (() => () => () => P.#m)()()(); }
    static viaSwitch(k = 1) { switch (k) { case 1: return P.#m; default: return undefined; } }
    static viaLabel() { out: { if (P.name !== undefined) break out; return undefined; } return P.#m; }
    field = P.#m;
    viaInstance() { return P.#m; }
    static early: unknown = undefined;
    static viaNullishEarly = P.viaNullish();
    static { P.early = P.#m; }
    static same() { return P.#m === P.#m; }
    static sameInlined() { return P.m() === P.m(); }
    static a() { return P.#a; }
    static g() { return P.#g; }
    static ag() { return P.#ag; }
}; }${d}
check("${e}make(2));`,
    ),
    ...family(
      `method-identity-top-level-block-no-capture.ts	in a block at the top level and captures nothing	{ 	7	n", P, null); }
method-identity-top-level-block-with-capture.ts	in a block at the top level and captures a variable	{ 	n	c", P, null); }
method-identity-top-level-class-no-capture.ts	at the top level and captures nothing		7	n", P, null);`,
      (
        a,
        b,
        c,
        d,
      ) => `// A private method is the same function object every time it is read: the class is declared ${a}.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown): void { console.log(label + ": " + said(f)); }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

const ways = ["viaThis", "viaArrow", "viaFunction", "viaDefault", "viaTry", "viaLoop", "viaCond", "viaInner", "viaLiteral", "viaArray", "viaSpread", "viaTemplate", "viaComma", "viaChain", "viaParen", "viaNullish", "viaAssign", "viaPattern", "viaHeritage", "viaKeyOfInner", "viaLiteralMethod", "viaLiteralGetter", "viaCatch", "viaRest", "viaFieldOfInner", "viaStaticBlockOfInner", "viaDeepArrows", "viaSwitch", "viaLabel"];
function check(label: string, A: any, B: any) {
  const f = A.m();
  for (const way of ways) row(label + " " + way, () => A[way]() === f);
  row(label + " viaGetter", () => A.viaGetter === f);
  row(label + " viaGenerator", () => A.viaGenerator().next().value === f);
  row(label + " viaInstance", () => new A().viaInstance() === f && new A().field === f);
  row(label + " early", () => A.early === f && A.viaNullishEarly === f);
  row(label + " same", () => A.same());
  row(label + " sameInlined", () => A.sameInlined());
  row(label + " called", () => f());
  row(label + " what it is", () => f.name + " " + f.length + " " + typeof f + " " + ("prototype" in f));
  row(label + " no constructor", () => new f());
  row(label + " kinds", () => [A.a() === A.a(), A.g() === A.g(), A.ag() === A.ag(), A.a() === A.m(), A.g() === A.ag()].join());
  row(label + " kinds run", () => [A.g()().next().value, typeof A.a()().then, typeof A.ag()().next].join());
  row(label + " mark", () => { f.mark = label; return A.viaThis().mark; });
  row(label + " mark behind a collection", () => { collect(); return A.viaArrow().mark; });
  row(label + " set", () => { const s = new Set(); s.add(A.m()); s.add(A.viaThis()); const n = s.size; s.delete(A.viaArrow()); return n + " " + s.size; });
  row(label + " weak map", () => { const w = new WeakMap(); w.set(A.m(), 5); return w.get(A.viaTry()); });
  row(label + " index", () => [A.a(), A.m(), A.g()].indexOf(A.viaLoop()));
  row(label + " switch", () => { switch (A.m()) { case A.a(): return "a"; case A.viaChain(): return "m"; default: return "none"; } });
  row(label + " its generator's prototype is kept", () => A.g().prototype === A.g().prototype);
  if (!B) return;
  row(label + " another evaluation", () => A.m() === B.m());
  row(label + " another evaluation's kinds", () => [A.a() === B.a(), A.g() === B.g(), A.ag() === B.ag()].join());
  row(label + " another evaluation called", () => B.m()() + " " + A.m()());
  row(label + " another evaluation's mark", () => B.m().mark);
  row(label + " two in a set", () => new Set([A.m(), B.m(), A.viaThis(), B.viaThis()]).size);
}
${b}const n = 1;
class P {
    static #m() { return ${c}; }
    static async #a() { return ${c}; }
    static *#g() { yield ${c}; }
    static async *#ag() { yield ${c}; }
    static m() { return P.#m; }
    static viaThis() { return this.#m; }
    static viaArrow() { return (() => P.#m)(); }
    static viaFunction() { return (function () { return P.#m; })(); }
    static get viaGetter() { return P.#m; }
    static viaDefault(f = P.#m) { return f; }
    static viaTry() { try { return P.#m; } finally { } }
    static viaLoop() { let f; for (let i = 0; i < 3; i++) f = P.#m; return f; }
    static viaCond(c?: boolean) { return c ? P.#m : P.#m; }
    static *viaGenerator() { yield P.#m; }
    static viaInner() { return class Q { static q() { return P.#m; } }.q(); }
    static viaLiteral() { return { f: P.#m }.f; }
    static viaArray() { return [P.#m][0]; }
    static viaSpread() { return [...[P.#m]][0]; }
    static viaTemplate() { return ((s: TemplateStringsArray, f: unknown) => f)\`\${P.#m}\`; }
    static viaComma() { return (P.name, P.#m); }
    static viaChain() { return P.#m; }
    static viaParen() { return (P).#m; }
    static viaNullish() { return P.early ?? P.#m; }
    static viaAssign() { let f; f = P.#m; return f; }
    static viaPattern() { const { f } = { f: P.#m }; return f; }
    static viaHeritage() { let f; class X extends (f = P.#m, Object) {} return f; }
    static viaKeyOfInner() { let f; class X { [(f = P.#m, "k")]() {} } return f; }
    static viaLiteralMethod() { return { m() { return P.#m; } }.m(); }
    static viaLiteralGetter() { return { get g() { return P.#m; } }.g; }
    static viaCatch() { try { throw 0; } catch { return P.#m; } }
    static viaRest(...a: unknown[]) { return [P.#m, ...a][0]; }
    static viaFieldOfInner() { return new (class { v = P.#m; })().v; }
    static viaStaticBlockOfInner() { let f; class X { static { f = P.#m; } } return f; }
    static viaDeepArrows() { return (() => () => () => P.#m)()()(); }
    static viaSwitch(k = 1) { switch (k) { case 1: return P.#m; default: return undefined; } }
    static viaLabel() { out: { if (P.name !== undefined) break out; return undefined; } return P.#m; }
    field = P.#m;
    viaInstance() { return P.#m; }
    static early: unknown = undefined;
    static viaNullishEarly = P.viaNullish();
    static { P.early = P.#m; }
    static same() { return P.#m === P.#m; }
    static sameInlined() { return P.m() === P.m(); }
    static a() { return P.#a; }
    static g() { return P.#g; }
    static ag() { return P.#ag; }
}
check("${d}`,
    ),
    ...written,
    ...untypedTwins(
      "private-class-members",
      "js",
      [
        "in-operator",
        "instance-method-identity",
        "static-async-methods-once-per-evaluation",
        "static-fields-before-init-in-function",
        "static-fields-before-init-top-level",
        "super-and-this-in-method-values",
        "throwing-static-initializers",
        "uninitialized-members-in-function",
        "uninitialized-members-top-level",
      ],
      written,
    ),
    "large-class-static-and-instance-names.js": text(
      `// Generated: a very large class in which static methods use instance private names and instance methods use static ones.
function said(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
class Giant {
  #f() { return 42; }
  static #s() { return 7; }`,
      [
        1250,
        n => `  static a${2 * n}() { return this.#f(); }
  b${2 * n + 1}() { return this.#s(); }`,
      ],
      `}
const g = new Giant(); let right = 0, threw = 0;
for (let i = 0; i < 2500; i++) { const f = i % 2 == 0 ? Giant["a" + i] : g["b" + i]; if (said(() => f.call(i % 2 == 0 ? g : Giant)) === (i % 2 == 0 ? "42" : "7")) right++; if (said(() => f.call(i % 2 == 0 ? Giant : g)) === "threw TypeError") threw++; }
console.log("found: " + right); console.log("threw: " + threw);
`,
    ),
    "many-static-methods-untyped.js": text(
      `// Generated: a class with very many static private methods, each of which is a distinct function (the same program without type annotations).
function said(f) { try { return String(f()); } catch (e) { return "threw " + (e).name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
const collect = (globalThis).gc ?? (() => (globalThis).Bun.gc(true));
function make(n) {
  return class G {`,
      [320, n => `    static #m${n}() { return n + ${n}; }`],
      `    static all() { return [G.#m0, G.#m1, G.#m2, G.#m3, G.#m4, G.#m5, G.#m6, G.#m7, G.#m8, G.#m9, G.#m10, G.#m11, G.#m12, G.#m13, G.#m14, G.#m15, G.#m16, G.#m17, G.#m18, G.#m19, G.#m20, G.#m21, G.#m22, G.#m23, G.#m24, G.#m25, G.#m26, G.#m27, G.#m28, G.#m29, G.#m30, G.#m31, G.#m32, G.#m33, G.#m34, G.#m35, G.#m36, G.#m37, G.#m38, G.#m39, G.#m40, G.#m41, G.#m42, G.#m43, G.#m44, G.#m45, G.#m46, G.#m47, G.#m48, G.#m49, G.#m50, G.#m51, G.#m52, G.#m53, G.#m54, G.#m55, G.#m56, G.#m57, G.#m58, G.#m59, G.#m60, G.#m61, G.#m62, G.#m63, G.#m64, G.#m65, G.#m66, G.#m67, G.#m68, G.#m69, G.#m70, G.#m71, G.#m72, G.#m73, G.#m74, G.#m75, G.#m76, G.#m77, G.#m78, G.#m79, G.#m80, G.#m81, G.#m82, G.#m83, G.#m84, G.#m85, G.#m86, G.#m87, G.#m88, G.#m89, G.#m90, G.#m91, G.#m92, G.#m93, G.#m94, G.#m95, G.#m96, G.#m97, G.#m98, G.#m99, G.#m100, G.#m101, G.#m102, G.#m103, G.#m104, G.#m105, G.#m106, G.#m107, G.#m108, G.#m109, G.#m110, G.#m111, G.#m112, G.#m113, G.#m114, G.#m115, G.#m116, G.#m117, G.#m118, G.#m119, G.#m120, G.#m121, G.#m122, G.#m123, G.#m124, G.#m125, G.#m126, G.#m127, G.#m128, G.#m129, G.#m130, G.#m131, G.#m132, G.#m133, G.#m134, G.#m135, G.#m136, G.#m137, G.#m138, G.#m139, G.#m140, G.#m141, G.#m142, G.#m143, G.#m144, G.#m145, G.#m146, G.#m147, G.#m148, G.#m149, G.#m150, G.#m151, G.#m152, G.#m153, G.#m154, G.#m155, G.#m156, G.#m157, G.#m158, G.#m159, G.#m160, G.#m161, G.#m162, G.#m163, G.#m164, G.#m165, G.#m166, G.#m167, G.#m168, G.#m169, G.#m170, G.#m171, G.#m172, G.#m173, G.#m174, G.#m175, G.#m176, G.#m177, G.#m178, G.#m179, G.#m180, G.#m181, G.#m182, G.#m183, G.#m184, G.#m185, G.#m186, G.#m187, G.#m188, G.#m189, G.#m190, G.#m191, G.#m192, G.#m193, G.#m194, G.#m195, G.#m196, G.#m197, G.#m198, G.#m199, G.#m200, G.#m201, G.#m202, G.#m203, G.#m204, G.#m205, G.#m206, G.#m207, G.#m208, G.#m209, G.#m210, G.#m211, G.#m212, G.#m213, G.#m214, G.#m215, G.#m216, G.#m217, G.#m218, G.#m219, G.#m220, G.#m221, G.#m222, G.#m223, G.#m224, G.#m225, G.#m226, G.#m227, G.#m228, G.#m229, G.#m230, G.#m231, G.#m232, G.#m233, G.#m234, G.#m235, G.#m236, G.#m237, G.#m238, G.#m239, G.#m240, G.#m241, G.#m242, G.#m243, G.#m244, G.#m245, G.#m246, G.#m247, G.#m248, G.#m249, G.#m250, G.#m251, G.#m252, G.#m253, G.#m254, G.#m255, G.#m256, G.#m257, G.#m258, G.#m259, G.#m260, G.#m261, G.#m262, G.#m263, G.#m264, G.#m265, G.#m266, G.#m267, G.#m268, G.#m269, G.#m270, G.#m271, G.#m272, G.#m273, G.#m274, G.#m275, G.#m276, G.#m277, G.#m278, G.#m279, G.#m280, G.#m281, G.#m282, G.#m283, G.#m284, G.#m285, G.#m286, G.#m287, G.#m288, G.#m289, G.#m290, G.#m291, G.#m292, G.#m293, G.#m294, G.#m295, G.#m296, G.#m297, G.#m298, G.#m299, G.#m300, G.#m301, G.#m302, G.#m303, G.#m304, G.#m305, G.#m306, G.#m307, G.#m308, G.#m309, G.#m310, G.#m311, G.#m312, G.#m313, G.#m314, G.#m315, G.#m316, G.#m317, G.#m318, G.#m319]; }`,
      [320, n => `    static #f${n} = ${n};`],
      `    static sum() { return G.#f0 + G.#f1 + G.#f2 + G.#f3 + G.#f4 + G.#f5 + G.#f6 + G.#f7 + G.#f8 + G.#f9 + G.#f10 + G.#f11 + G.#f12 + G.#f13 + G.#f14 + G.#f15 + G.#f16 + G.#f17 + G.#f18 + G.#f19 + G.#f20 + G.#f21 + G.#f22 + G.#f23 + G.#f24 + G.#f25 + G.#f26 + G.#f27 + G.#f28 + G.#f29 + G.#f30 + G.#f31 + G.#f32 + G.#f33 + G.#f34 + G.#f35 + G.#f36 + G.#f37 + G.#f38 + G.#f39 + G.#f40 + G.#f41 + G.#f42 + G.#f43 + G.#f44 + G.#f45 + G.#f46 + G.#f47 + G.#f48 + G.#f49 + G.#f50 + G.#f51 + G.#f52 + G.#f53 + G.#f54 + G.#f55 + G.#f56 + G.#f57 + G.#f58 + G.#f59 + G.#f60 + G.#f61 + G.#f62 + G.#f63 + G.#f64 + G.#f65 + G.#f66 + G.#f67 + G.#f68 + G.#f69 + G.#f70 + G.#f71 + G.#f72 + G.#f73 + G.#f74 + G.#f75 + G.#f76 + G.#f77 + G.#f78 + G.#f79 + G.#f80 + G.#f81 + G.#f82 + G.#f83 + G.#f84 + G.#f85 + G.#f86 + G.#f87 + G.#f88 + G.#f89 + G.#f90 + G.#f91 + G.#f92 + G.#f93 + G.#f94 + G.#f95 + G.#f96 + G.#f97 + G.#f98 + G.#f99 + G.#f100 + G.#f101 + G.#f102 + G.#f103 + G.#f104 + G.#f105 + G.#f106 + G.#f107 + G.#f108 + G.#f109 + G.#f110 + G.#f111 + G.#f112 + G.#f113 + G.#f114 + G.#f115 + G.#f116 + G.#f117 + G.#f118 + G.#f119 + G.#f120 + G.#f121 + G.#f122 + G.#f123 + G.#f124 + G.#f125 + G.#f126 + G.#f127 + G.#f128 + G.#f129 + G.#f130 + G.#f131 + G.#f132 + G.#f133 + G.#f134 + G.#f135 + G.#f136 + G.#f137 + G.#f138 + G.#f139 + G.#f140 + G.#f141 + G.#f142 + G.#f143 + G.#f144 + G.#f145 + G.#f146 + G.#f147 + G.#f148 + G.#f149 + G.#f150 + G.#f151 + G.#f152 + G.#f153 + G.#f154 + G.#f155 + G.#f156 + G.#f157 + G.#f158 + G.#f159 + G.#f160 + G.#f161 + G.#f162 + G.#f163 + G.#f164 + G.#f165 + G.#f166 + G.#f167 + G.#f168 + G.#f169 + G.#f170 + G.#f171 + G.#f172 + G.#f173 + G.#f174 + G.#f175 + G.#f176 + G.#f177 + G.#f178 + G.#f179 + G.#f180 + G.#f181 + G.#f182 + G.#f183 + G.#f184 + G.#f185 + G.#f186 + G.#f187 + G.#f188 + G.#f189 + G.#f190 + G.#f191 + G.#f192 + G.#f193 + G.#f194 + G.#f195 + G.#f196 + G.#f197 + G.#f198 + G.#f199 + G.#f200 + G.#f201 + G.#f202 + G.#f203 + G.#f204 + G.#f205 + G.#f206 + G.#f207 + G.#f208 + G.#f209 + G.#f210 + G.#f211 + G.#f212 + G.#f213 + G.#f214 + G.#f215 + G.#f216 + G.#f217 + G.#f218 + G.#f219 + G.#f220 + G.#f221 + G.#f222 + G.#f223 + G.#f224 + G.#f225 + G.#f226 + G.#f227 + G.#f228 + G.#f229 + G.#f230 + G.#f231 + G.#f232 + G.#f233 + G.#f234 + G.#f235 + G.#f236 + G.#f237 + G.#f238 + G.#f239 + G.#f240 + G.#f241 + G.#f242 + G.#f243 + G.#f244 + G.#f245 + G.#f246 + G.#f247 + G.#f248 + G.#f249 + G.#f250 + G.#f251 + G.#f252 + G.#f253 + G.#f254 + G.#f255 + G.#f256 + G.#f257 + G.#f258 + G.#f259 + G.#f260 + G.#f261 + G.#f262 + G.#f263 + G.#f264 + G.#f265 + G.#f266 + G.#f267 + G.#f268 + G.#f269 + G.#f270 + G.#f271 + G.#f272 + G.#f273 + G.#f274 + G.#f275 + G.#f276 + G.#f277 + G.#f278 + G.#f279 + G.#f280 + G.#f281 + G.#f282 + G.#f283 + G.#f284 + G.#f285 + G.#f286 + G.#f287 + G.#f288 + G.#f289 + G.#f290 + G.#f291 + G.#f292 + G.#f293 + G.#f294 + G.#f295 + G.#f296 + G.#f297 + G.#f298 + G.#f299 + G.#f300 + G.#f301 + G.#f302 + G.#f303 + G.#f304 + G.#f305 + G.#f306 + G.#f307 + G.#f308 + G.#f309 + G.#f310 + G.#f311 + G.#f312 + G.#f313 + G.#f314 + G.#f315 + G.#f316 + G.#f317 + G.#f318 + G.#f319; }
    static bump() { G.#f0++; G.#f1++; G.#f2++; G.#f3++; G.#f4++; G.#f5++; G.#f6++; G.#f7++; G.#f8++; G.#f9++; G.#f10++; G.#f11++; G.#f12++; G.#f13++; G.#f14++; G.#f15++; G.#f16++; G.#f17++; G.#f18++; G.#f19++; G.#f20++; G.#f21++; G.#f22++; G.#f23++; G.#f24++; G.#f25++; G.#f26++; G.#f27++; G.#f28++; G.#f29++; G.#f30++; G.#f31++; G.#f32++; G.#f33++; G.#f34++; G.#f35++; G.#f36++; G.#f37++; G.#f38++; G.#f39++; G.#f40++; G.#f41++; G.#f42++; G.#f43++; G.#f44++; G.#f45++; G.#f46++; G.#f47++; G.#f48++; G.#f49++; G.#f50++; G.#f51++; G.#f52++; G.#f53++; G.#f54++; G.#f55++; G.#f56++; G.#f57++; G.#f58++; G.#f59++; G.#f60++; G.#f61++; G.#f62++; G.#f63++; G.#f64++; G.#f65++; G.#f66++; G.#f67++; G.#f68++; G.#f69++; G.#f70++; G.#f71++; G.#f72++; G.#f73++; G.#f74++; G.#f75++; G.#f76++; G.#f77++; G.#f78++; G.#f79++; G.#f80++; G.#f81++; G.#f82++; G.#f83++; G.#f84++; G.#f85++; G.#f86++; G.#f87++; G.#f88++; G.#f89++; G.#f90++; G.#f91++; G.#f92++; G.#f93++; G.#f94++; G.#f95++; G.#f96++; G.#f97++; G.#f98++; G.#f99++; G.#f100++; G.#f101++; G.#f102++; G.#f103++; G.#f104++; G.#f105++; G.#f106++; G.#f107++; G.#f108++; G.#f109++; G.#f110++; G.#f111++; G.#f112++; G.#f113++; G.#f114++; G.#f115++; G.#f116++; G.#f117++; G.#f118++; G.#f119++; G.#f120++; G.#f121++; G.#f122++; G.#f123++; G.#f124++; G.#f125++; G.#f126++; G.#f127++; G.#f128++; G.#f129++; G.#f130++; G.#f131++; G.#f132++; G.#f133++; G.#f134++; G.#f135++; G.#f136++; G.#f137++; G.#f138++; G.#f139++; G.#f140++; G.#f141++; G.#f142++; G.#f143++; G.#f144++; G.#f145++; G.#f146++; G.#f147++; G.#f148++; G.#f149++; G.#f150++; G.#f151++; G.#f152++; G.#f153++; G.#f154++; G.#f155++; G.#f156++; G.#f157++; G.#f158++; G.#f159++; G.#f160++; G.#f161++; G.#f162++; G.#f163++; G.#f164++; G.#f165++; G.#f166++; G.#f167++; G.#f168++; G.#f169++; G.#f170++; G.#f171++; G.#f172++; G.#f173++; G.#f174++; G.#f175++; G.#f176++; G.#f177++; G.#f178++; G.#f179++; G.#f180++; G.#f181++; G.#f182++; G.#f183++; G.#f184++; G.#f185++; G.#f186++; G.#f187++; G.#f188++; G.#f189++; G.#f190++; G.#f191++; G.#f192++; G.#f193++; G.#f194++; G.#f195++; G.#f196++; G.#f197++; G.#f198++; G.#f199++; G.#f200++; G.#f201++; G.#f202++; G.#f203++; G.#f204++; G.#f205++; G.#f206++; G.#f207++; G.#f208++; G.#f209++; G.#f210++; G.#f211++; G.#f212++; G.#f213++; G.#f214++; G.#f215++; G.#f216++; G.#f217++; G.#f218++; G.#f219++; G.#f220++; G.#f221++; G.#f222++; G.#f223++; G.#f224++; G.#f225++; G.#f226++; G.#f227++; G.#f228++; G.#f229++; G.#f230++; G.#f231++; G.#f232++; G.#f233++; G.#f234++; G.#f235++; G.#f236++; G.#f237++; G.#f238++; G.#f239++; G.#f240++; G.#f241++; G.#f242++; G.#f243++; G.#f244++; G.#f245++; G.#f246++; G.#f247++; G.#f248++; G.#f249++; G.#f250++; G.#f251++; G.#f252++; G.#f253++; G.#f254++; G.#f255++; G.#f256++; G.#f257++; G.#f258++; G.#f259++; G.#f260++; G.#f261++; G.#f262++; G.#f263++; G.#f264++; G.#f265++; G.#f266++; G.#f267++; G.#f268++; G.#f269++; G.#f270++; G.#f271++; G.#f272++; G.#f273++; G.#f274++; G.#f275++; G.#f276++; G.#f277++; G.#f278++; G.#f279++; G.#f280++; G.#f281++; G.#f282++; G.#f283++; G.#f284++; G.#f285++; G.#f286++; G.#f287++; G.#f288++; G.#f289++; G.#f290++; G.#f291++; G.#f292++; G.#f293++; G.#f294++; G.#f295++; G.#f296++; G.#f297++; G.#f298++; G.#f299++; G.#f300++; G.#f301++; G.#f302++; G.#f303++; G.#f304++; G.#f305++; G.#f306++; G.#f307++; G.#f308++; G.#f309++; G.#f310++; G.#f311++; G.#f312++; G.#f313++; G.#f314++; G.#f315++; G.#f316++; G.#f317++; G.#f318++; G.#f319++; }
  };
}
const A = make(1), B = make(1000);
row("every one its own", () => new Set(A.all()).size);
row("every one kept", () => { const x = A.all(), y = A.all(); return x.every((f, i) => f === y[i]); });
row("none shared", () => new Set([...A.all(), ...B.all()]).size);
row("every one called", () => A.all().reduce((s, f) => s + f(), 0) + " " + B.all().reduce((s, f) => s + f(), 0));
row("the fields", () => { A.bump(); A.bump(); B.bump(); return A.sum() + " " + B.sum(); });
`,
    ),
    "many-static-methods.ts": text(
      `// Generated: a class with very many static private methods, each of which is a distinct function.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown): void { console.log(label + ": " + said(f)); }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));
function make(n: number) {
  return class G {`,
      [320, n => `    static #m${n}() { return n + ${n}; }`],
      `    static all() { return [G.#m0, G.#m1, G.#m2, G.#m3, G.#m4, G.#m5, G.#m6, G.#m7, G.#m8, G.#m9, G.#m10, G.#m11, G.#m12, G.#m13, G.#m14, G.#m15, G.#m16, G.#m17, G.#m18, G.#m19, G.#m20, G.#m21, G.#m22, G.#m23, G.#m24, G.#m25, G.#m26, G.#m27, G.#m28, G.#m29, G.#m30, G.#m31, G.#m32, G.#m33, G.#m34, G.#m35, G.#m36, G.#m37, G.#m38, G.#m39, G.#m40, G.#m41, G.#m42, G.#m43, G.#m44, G.#m45, G.#m46, G.#m47, G.#m48, G.#m49, G.#m50, G.#m51, G.#m52, G.#m53, G.#m54, G.#m55, G.#m56, G.#m57, G.#m58, G.#m59, G.#m60, G.#m61, G.#m62, G.#m63, G.#m64, G.#m65, G.#m66, G.#m67, G.#m68, G.#m69, G.#m70, G.#m71, G.#m72, G.#m73, G.#m74, G.#m75, G.#m76, G.#m77, G.#m78, G.#m79, G.#m80, G.#m81, G.#m82, G.#m83, G.#m84, G.#m85, G.#m86, G.#m87, G.#m88, G.#m89, G.#m90, G.#m91, G.#m92, G.#m93, G.#m94, G.#m95, G.#m96, G.#m97, G.#m98, G.#m99, G.#m100, G.#m101, G.#m102, G.#m103, G.#m104, G.#m105, G.#m106, G.#m107, G.#m108, G.#m109, G.#m110, G.#m111, G.#m112, G.#m113, G.#m114, G.#m115, G.#m116, G.#m117, G.#m118, G.#m119, G.#m120, G.#m121, G.#m122, G.#m123, G.#m124, G.#m125, G.#m126, G.#m127, G.#m128, G.#m129, G.#m130, G.#m131, G.#m132, G.#m133, G.#m134, G.#m135, G.#m136, G.#m137, G.#m138, G.#m139, G.#m140, G.#m141, G.#m142, G.#m143, G.#m144, G.#m145, G.#m146, G.#m147, G.#m148, G.#m149, G.#m150, G.#m151, G.#m152, G.#m153, G.#m154, G.#m155, G.#m156, G.#m157, G.#m158, G.#m159, G.#m160, G.#m161, G.#m162, G.#m163, G.#m164, G.#m165, G.#m166, G.#m167, G.#m168, G.#m169, G.#m170, G.#m171, G.#m172, G.#m173, G.#m174, G.#m175, G.#m176, G.#m177, G.#m178, G.#m179, G.#m180, G.#m181, G.#m182, G.#m183, G.#m184, G.#m185, G.#m186, G.#m187, G.#m188, G.#m189, G.#m190, G.#m191, G.#m192, G.#m193, G.#m194, G.#m195, G.#m196, G.#m197, G.#m198, G.#m199, G.#m200, G.#m201, G.#m202, G.#m203, G.#m204, G.#m205, G.#m206, G.#m207, G.#m208, G.#m209, G.#m210, G.#m211, G.#m212, G.#m213, G.#m214, G.#m215, G.#m216, G.#m217, G.#m218, G.#m219, G.#m220, G.#m221, G.#m222, G.#m223, G.#m224, G.#m225, G.#m226, G.#m227, G.#m228, G.#m229, G.#m230, G.#m231, G.#m232, G.#m233, G.#m234, G.#m235, G.#m236, G.#m237, G.#m238, G.#m239, G.#m240, G.#m241, G.#m242, G.#m243, G.#m244, G.#m245, G.#m246, G.#m247, G.#m248, G.#m249, G.#m250, G.#m251, G.#m252, G.#m253, G.#m254, G.#m255, G.#m256, G.#m257, G.#m258, G.#m259, G.#m260, G.#m261, G.#m262, G.#m263, G.#m264, G.#m265, G.#m266, G.#m267, G.#m268, G.#m269, G.#m270, G.#m271, G.#m272, G.#m273, G.#m274, G.#m275, G.#m276, G.#m277, G.#m278, G.#m279, G.#m280, G.#m281, G.#m282, G.#m283, G.#m284, G.#m285, G.#m286, G.#m287, G.#m288, G.#m289, G.#m290, G.#m291, G.#m292, G.#m293, G.#m294, G.#m295, G.#m296, G.#m297, G.#m298, G.#m299, G.#m300, G.#m301, G.#m302, G.#m303, G.#m304, G.#m305, G.#m306, G.#m307, G.#m308, G.#m309, G.#m310, G.#m311, G.#m312, G.#m313, G.#m314, G.#m315, G.#m316, G.#m317, G.#m318, G.#m319]; }`,
      [320, n => `    static #f${n} = ${n};`],
      `    static sum() { return G.#f0 + G.#f1 + G.#f2 + G.#f3 + G.#f4 + G.#f5 + G.#f6 + G.#f7 + G.#f8 + G.#f9 + G.#f10 + G.#f11 + G.#f12 + G.#f13 + G.#f14 + G.#f15 + G.#f16 + G.#f17 + G.#f18 + G.#f19 + G.#f20 + G.#f21 + G.#f22 + G.#f23 + G.#f24 + G.#f25 + G.#f26 + G.#f27 + G.#f28 + G.#f29 + G.#f30 + G.#f31 + G.#f32 + G.#f33 + G.#f34 + G.#f35 + G.#f36 + G.#f37 + G.#f38 + G.#f39 + G.#f40 + G.#f41 + G.#f42 + G.#f43 + G.#f44 + G.#f45 + G.#f46 + G.#f47 + G.#f48 + G.#f49 + G.#f50 + G.#f51 + G.#f52 + G.#f53 + G.#f54 + G.#f55 + G.#f56 + G.#f57 + G.#f58 + G.#f59 + G.#f60 + G.#f61 + G.#f62 + G.#f63 + G.#f64 + G.#f65 + G.#f66 + G.#f67 + G.#f68 + G.#f69 + G.#f70 + G.#f71 + G.#f72 + G.#f73 + G.#f74 + G.#f75 + G.#f76 + G.#f77 + G.#f78 + G.#f79 + G.#f80 + G.#f81 + G.#f82 + G.#f83 + G.#f84 + G.#f85 + G.#f86 + G.#f87 + G.#f88 + G.#f89 + G.#f90 + G.#f91 + G.#f92 + G.#f93 + G.#f94 + G.#f95 + G.#f96 + G.#f97 + G.#f98 + G.#f99 + G.#f100 + G.#f101 + G.#f102 + G.#f103 + G.#f104 + G.#f105 + G.#f106 + G.#f107 + G.#f108 + G.#f109 + G.#f110 + G.#f111 + G.#f112 + G.#f113 + G.#f114 + G.#f115 + G.#f116 + G.#f117 + G.#f118 + G.#f119 + G.#f120 + G.#f121 + G.#f122 + G.#f123 + G.#f124 + G.#f125 + G.#f126 + G.#f127 + G.#f128 + G.#f129 + G.#f130 + G.#f131 + G.#f132 + G.#f133 + G.#f134 + G.#f135 + G.#f136 + G.#f137 + G.#f138 + G.#f139 + G.#f140 + G.#f141 + G.#f142 + G.#f143 + G.#f144 + G.#f145 + G.#f146 + G.#f147 + G.#f148 + G.#f149 + G.#f150 + G.#f151 + G.#f152 + G.#f153 + G.#f154 + G.#f155 + G.#f156 + G.#f157 + G.#f158 + G.#f159 + G.#f160 + G.#f161 + G.#f162 + G.#f163 + G.#f164 + G.#f165 + G.#f166 + G.#f167 + G.#f168 + G.#f169 + G.#f170 + G.#f171 + G.#f172 + G.#f173 + G.#f174 + G.#f175 + G.#f176 + G.#f177 + G.#f178 + G.#f179 + G.#f180 + G.#f181 + G.#f182 + G.#f183 + G.#f184 + G.#f185 + G.#f186 + G.#f187 + G.#f188 + G.#f189 + G.#f190 + G.#f191 + G.#f192 + G.#f193 + G.#f194 + G.#f195 + G.#f196 + G.#f197 + G.#f198 + G.#f199 + G.#f200 + G.#f201 + G.#f202 + G.#f203 + G.#f204 + G.#f205 + G.#f206 + G.#f207 + G.#f208 + G.#f209 + G.#f210 + G.#f211 + G.#f212 + G.#f213 + G.#f214 + G.#f215 + G.#f216 + G.#f217 + G.#f218 + G.#f219 + G.#f220 + G.#f221 + G.#f222 + G.#f223 + G.#f224 + G.#f225 + G.#f226 + G.#f227 + G.#f228 + G.#f229 + G.#f230 + G.#f231 + G.#f232 + G.#f233 + G.#f234 + G.#f235 + G.#f236 + G.#f237 + G.#f238 + G.#f239 + G.#f240 + G.#f241 + G.#f242 + G.#f243 + G.#f244 + G.#f245 + G.#f246 + G.#f247 + G.#f248 + G.#f249 + G.#f250 + G.#f251 + G.#f252 + G.#f253 + G.#f254 + G.#f255 + G.#f256 + G.#f257 + G.#f258 + G.#f259 + G.#f260 + G.#f261 + G.#f262 + G.#f263 + G.#f264 + G.#f265 + G.#f266 + G.#f267 + G.#f268 + G.#f269 + G.#f270 + G.#f271 + G.#f272 + G.#f273 + G.#f274 + G.#f275 + G.#f276 + G.#f277 + G.#f278 + G.#f279 + G.#f280 + G.#f281 + G.#f282 + G.#f283 + G.#f284 + G.#f285 + G.#f286 + G.#f287 + G.#f288 + G.#f289 + G.#f290 + G.#f291 + G.#f292 + G.#f293 + G.#f294 + G.#f295 + G.#f296 + G.#f297 + G.#f298 + G.#f299 + G.#f300 + G.#f301 + G.#f302 + G.#f303 + G.#f304 + G.#f305 + G.#f306 + G.#f307 + G.#f308 + G.#f309 + G.#f310 + G.#f311 + G.#f312 + G.#f313 + G.#f314 + G.#f315 + G.#f316 + G.#f317 + G.#f318 + G.#f319; }
    static bump() { G.#f0++; G.#f1++; G.#f2++; G.#f3++; G.#f4++; G.#f5++; G.#f6++; G.#f7++; G.#f8++; G.#f9++; G.#f10++; G.#f11++; G.#f12++; G.#f13++; G.#f14++; G.#f15++; G.#f16++; G.#f17++; G.#f18++; G.#f19++; G.#f20++; G.#f21++; G.#f22++; G.#f23++; G.#f24++; G.#f25++; G.#f26++; G.#f27++; G.#f28++; G.#f29++; G.#f30++; G.#f31++; G.#f32++; G.#f33++; G.#f34++; G.#f35++; G.#f36++; G.#f37++; G.#f38++; G.#f39++; G.#f40++; G.#f41++; G.#f42++; G.#f43++; G.#f44++; G.#f45++; G.#f46++; G.#f47++; G.#f48++; G.#f49++; G.#f50++; G.#f51++; G.#f52++; G.#f53++; G.#f54++; G.#f55++; G.#f56++; G.#f57++; G.#f58++; G.#f59++; G.#f60++; G.#f61++; G.#f62++; G.#f63++; G.#f64++; G.#f65++; G.#f66++; G.#f67++; G.#f68++; G.#f69++; G.#f70++; G.#f71++; G.#f72++; G.#f73++; G.#f74++; G.#f75++; G.#f76++; G.#f77++; G.#f78++; G.#f79++; G.#f80++; G.#f81++; G.#f82++; G.#f83++; G.#f84++; G.#f85++; G.#f86++; G.#f87++; G.#f88++; G.#f89++; G.#f90++; G.#f91++; G.#f92++; G.#f93++; G.#f94++; G.#f95++; G.#f96++; G.#f97++; G.#f98++; G.#f99++; G.#f100++; G.#f101++; G.#f102++; G.#f103++; G.#f104++; G.#f105++; G.#f106++; G.#f107++; G.#f108++; G.#f109++; G.#f110++; G.#f111++; G.#f112++; G.#f113++; G.#f114++; G.#f115++; G.#f116++; G.#f117++; G.#f118++; G.#f119++; G.#f120++; G.#f121++; G.#f122++; G.#f123++; G.#f124++; G.#f125++; G.#f126++; G.#f127++; G.#f128++; G.#f129++; G.#f130++; G.#f131++; G.#f132++; G.#f133++; G.#f134++; G.#f135++; G.#f136++; G.#f137++; G.#f138++; G.#f139++; G.#f140++; G.#f141++; G.#f142++; G.#f143++; G.#f144++; G.#f145++; G.#f146++; G.#f147++; G.#f148++; G.#f149++; G.#f150++; G.#f151++; G.#f152++; G.#f153++; G.#f154++; G.#f155++; G.#f156++; G.#f157++; G.#f158++; G.#f159++; G.#f160++; G.#f161++; G.#f162++; G.#f163++; G.#f164++; G.#f165++; G.#f166++; G.#f167++; G.#f168++; G.#f169++; G.#f170++; G.#f171++; G.#f172++; G.#f173++; G.#f174++; G.#f175++; G.#f176++; G.#f177++; G.#f178++; G.#f179++; G.#f180++; G.#f181++; G.#f182++; G.#f183++; G.#f184++; G.#f185++; G.#f186++; G.#f187++; G.#f188++; G.#f189++; G.#f190++; G.#f191++; G.#f192++; G.#f193++; G.#f194++; G.#f195++; G.#f196++; G.#f197++; G.#f198++; G.#f199++; G.#f200++; G.#f201++; G.#f202++; G.#f203++; G.#f204++; G.#f205++; G.#f206++; G.#f207++; G.#f208++; G.#f209++; G.#f210++; G.#f211++; G.#f212++; G.#f213++; G.#f214++; G.#f215++; G.#f216++; G.#f217++; G.#f218++; G.#f219++; G.#f220++; G.#f221++; G.#f222++; G.#f223++; G.#f224++; G.#f225++; G.#f226++; G.#f227++; G.#f228++; G.#f229++; G.#f230++; G.#f231++; G.#f232++; G.#f233++; G.#f234++; G.#f235++; G.#f236++; G.#f237++; G.#f238++; G.#f239++; G.#f240++; G.#f241++; G.#f242++; G.#f243++; G.#f244++; G.#f245++; G.#f246++; G.#f247++; G.#f248++; G.#f249++; G.#f250++; G.#f251++; G.#f252++; G.#f253++; G.#f254++; G.#f255++; G.#f256++; G.#f257++; G.#f258++; G.#f259++; G.#f260++; G.#f261++; G.#f262++; G.#f263++; G.#f264++; G.#f265++; G.#f266++; G.#f267++; G.#f268++; G.#f269++; G.#f270++; G.#f271++; G.#f272++; G.#f273++; G.#f274++; G.#f275++; G.#f276++; G.#f277++; G.#f278++; G.#f279++; G.#f280++; G.#f281++; G.#f282++; G.#f283++; G.#f284++; G.#f285++; G.#f286++; G.#f287++; G.#f288++; G.#f289++; G.#f290++; G.#f291++; G.#f292++; G.#f293++; G.#f294++; G.#f295++; G.#f296++; G.#f297++; G.#f298++; G.#f299++; G.#f300++; G.#f301++; G.#f302++; G.#f303++; G.#f304++; G.#f305++; G.#f306++; G.#f307++; G.#f308++; G.#f309++; G.#f310++; G.#f311++; G.#f312++; G.#f313++; G.#f314++; G.#f315++; G.#f316++; G.#f317++; G.#f318++; G.#f319++; }
  };
}
const A = make(1), B = make(1000);
row("every one its own", () => new Set(A.all()).size);
row("every one kept", () => { const x = A.all(), y = A.all(); return x.every((f, i) => f === y[i]); });
row("none shared", () => new Set([...A.all(), ...B.all()]).size);
row("every one called", () => A.all().reduce((s, f) => s + f(), 0) + " " + B.all().reduce((s, f) => s + f(), 0));
row("the fields", () => { A.bump(); A.bump(); B.bump(); return A.sum() + " " + B.sum(); });
`,
    ),
  });
