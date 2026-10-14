// Code that runs during a class's static initialization observes private members that are not initialized yet, in classes at the top level.
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
const one: number = 1, nothing: any = null;
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = peek();
      static #after = 1;
      static report = leak();
    }
    console.log("top a call: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = (peek(), 1);
      static #after = 1;
      static report = leak();
    }
    console.log("top a call in a comma: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = new Peeker();
      static #after = 1;
      static report = leak();
    }
    console.log("top new of a class of the program: " + seen + " | " + C.report);
}
{
    seen = "";
    class Map { constructor() { peek(); } }
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = new Map();
      static #after = 1;
      static report = leak();
    }
    console.log("top new Map of the program: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = new globalMap(peeking);
      static #after = 1;
      static report = leak();
    }
    console.log("top new Map with an argument: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = { [peek()]: 1 };
      static #after = 1;
      static report = leak();
    }
    console.log("top a computed name: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = { ...withGetter };
      static #after = 1;
      static report = leak();
    }
    console.log("top a spread object: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = [...peeking];
      static #after = 1;
      static report = leak();
    }
    console.log("top a spread array: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = [1, peek()];
      static #after = 1;
      static report = leak();
    }
    console.log("top an element: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = { a: { b: peek() } };
      static #after = 1;
      static report = leak();
    }
    console.log("top a value in a literal: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = `${withToString}`;
      static #after = 1;
      static report = leak();
    }
    console.log("top a template: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = -withValueOf;
      static #after = 1;
      static report = leak();
    }
    console.log("top minus of an object: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = +withValueOf;
      static #after = 1;
      static report = leak();
    }
    console.log("top plus of an object: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = 1 + withValueOf;
      static #after = 1;
      static report = leak();
    }
    console.log("top a sum: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = tag`x`;
      static #after = 1;
      static report = leak();
    }
    console.log("top a tag: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = (() => peek())();
      static #after = 1;
      static report = leak();
    }
    console.log("top an iife: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = class { static { peek(); } };
      static #after = 1;
      static report = leak();
    }
    console.log("top a class with a static block: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = class { static x = peek(); };
      static #after = 1;
      static report = leak();
    }
    console.log("top a class with a static field: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = class { [peek()]() {} };
      static #after = 1;
      static report = leak();
    }
    console.log("top a class with a computed name: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = class extends (peek(), Object) {};
      static #after = 1;
      static report = leak();
    }
    console.log("top a class with a heritage: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = withGetter.g;
      static #after = 1;
      static report = leak();
    }
    console.log("top a getter read: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = proxied[0];
      static #after = 1;
      static report = leak();
    }
    console.log("top an element read: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = "x" in proxied;
      static #after = 1;
      static report = leak();
    }
    console.log("top in: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = withGetter instanceof hasInstance;
      static #after = 1;
      static report = leak();
    }
    console.log("top instanceof: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = one ? peek() : 0;
      static #after = 1;
      static report = leak();
    }
    console.log("top a conditional: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = one && peek();
      static #after = 1;
      static report = leak();
    }
    console.log("top a logical: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = nothing ?? peek();
      static #after = 1;
      static report = leak();
    }
    console.log("top nullish: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = withSetter.s = 1;
      static #after = 1;
      static report = leak();
    }
    console.log("top an assignment: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = typeof peek();
      static #after = 1;
      static report = leak();
    }
    console.log("top typeof a call: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = void peek();
      static #after = 1;
      static report = leak();
    }
    console.log("top void a call: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = peek?.();
      static #after = 1;
      static report = leak();
    }
    console.log("top an optional call: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any;
      static #after = 1;
      static report = leak();
    }
    console.log("top nothing: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = null;
      static #after = 1;
      static report = leak();
    }
    console.log("top null: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = true;
      static #after = 1;
      static report = leak();
    }
    console.log("top true: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = 5;
      static #after = 1;
      static report = leak();
    }
    console.log("top a number: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = -5;
      static #after = 1;
      static report = leak();
    }
    console.log("top minus a number: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = "s";
      static #after = 1;
      static report = leak();
    }
    console.log("top a string: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = 5n;
      static #after = 1;
      static report = leak();
    }
    console.log("top a bigint: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = () => peek();
      static #after = 1;
      static report = leak();
    }
    console.log("top an arrow: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = function () { return peek(); };
      static #after = 1;
      static report = leak();
    }
    console.log("top a function: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = async () => peek();
      static #after = 1;
      static report = leak();
    }
    console.log("top an async arrow: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = function* () { yield peek(); };
      static #after = 1;
      static report = leak();
    }
    console.log("top a generator function: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = [1, , "a", [null], () => peek()];
      static #after = 1;
      static report = leak();
    }
    console.log("top an array: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = { a: 1, "b c": [2], 3: null, m() { return peek(); }, get g() { return peek(); }, set g(v) { peek(); }, __proto__: null };
      static #after = 1;
      static report = leak();
    }
    console.log("top an object: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = new Map();
      static #after = 1;
      static report = leak();
    }
    console.log("top new Map: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = new Set();
      static #after = 1;
      static report = leak();
    }
    console.log("top new Set: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      // @ts-ignore
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      // @ts-ignore
      static #it: any = new WeakMap();
      static #after = 1;
      static report = leak();
    }
    console.log("top new WeakMap: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
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
