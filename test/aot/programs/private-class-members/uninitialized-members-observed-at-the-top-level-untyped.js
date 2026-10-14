// Code that runs during a class's static initialization observes private members that are not initialized yet, in classes at the top level (the same program without type annotations).
function said(f) { try { return String(f()); } catch (e) { return "threw " + (e).name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
const collect = (globalThis).gc ?? (() => (globalThis).Bun.gc(true));

let seen = "", leak = () => "no leak";
function peek() { seen += "[" + leak() + "]"; return 1; }
class Peeker { constructor() { peek(); } }
const globalMap = Map;
const peeking = { [Symbol.iterator]() { peek(); return [][Symbol.iterator](); } };
const withGetter = { get g() { return peek(); } };
const withSetter = { set s(v) { peek(); } };
const withToString = { toString() { peek(); return "s"; } };
const withValueOf = { valueOf() { peek(); return 1; } };
const proxied = new Proxy({}, { get() { return peek(); }, has() { peek(); return true; } });
const hasInstance = { [Symbol.hasInstance]() { peek(); return true; } };
function tag(s) { return peek(); }
const one = 1, nothing = null;
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = peek();
      static #after = 1;
      static report = leak();
    }
    console.log("top a call: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = (peek(), 1);
      static #after = 1;
      static report = leak();
    }
    console.log("top a call in a comma: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = new Peeker();
      static #after = 1;
      static report = leak();
    }
    console.log("top new of a class of the program: " + seen + " | " + C.report);
}
{
    seen = "";
    class Map { constructor() { peek(); } }
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = new Map();
      static #after = 1;
      static report = leak();
    }
    console.log("top new Map of the program: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = new globalMap(peeking);
      static #after = 1;
      static report = leak();
    }
    console.log("top new Map with an argument: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = { [peek()]: 1 };
      static #after = 1;
      static report = leak();
    }
    console.log("top a computed name: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = { ...withGetter };
      static #after = 1;
      static report = leak();
    }
    console.log("top a spread object: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = [...peeking];
      static #after = 1;
      static report = leak();
    }
    console.log("top a spread array: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = [1, peek()];
      static #after = 1;
      static report = leak();
    }
    console.log("top an element: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = { a: { b: peek() } };
      static #after = 1;
      static report = leak();
    }
    console.log("top a value in a literal: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = `${withToString}`;
      static #after = 1;
      static report = leak();
    }
    console.log("top a template: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = -withValueOf;
      static #after = 1;
      static report = leak();
    }
    console.log("top minus of an object: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = +withValueOf;
      static #after = 1;
      static report = leak();
    }
    console.log("top plus of an object: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = 1 + withValueOf;
      static #after = 1;
      static report = leak();
    }
    console.log("top a sum: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = tag`x`;
      static #after = 1;
      static report = leak();
    }
    console.log("top a tag: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = (() => peek())();
      static #after = 1;
      static report = leak();
    }
    console.log("top an iife: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = class { static { peek(); } };
      static #after = 1;
      static report = leak();
    }
    console.log("top a class with a static block: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = class { static x = peek(); };
      static #after = 1;
      static report = leak();
    }
    console.log("top a class with a static field: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = class { [peek()]() {} };
      static #after = 1;
      static report = leak();
    }
    console.log("top a class with a computed name: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = class extends (peek(), Object) {};
      static #after = 1;
      static report = leak();
    }
    console.log("top a class with a heritage: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = withGetter.g;
      static #after = 1;
      static report = leak();
    }
    console.log("top a getter read: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = proxied[0];
      static #after = 1;
      static report = leak();
    }
    console.log("top an element read: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = "x" in proxied;
      static #after = 1;
      static report = leak();
    }
    console.log("top in: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = withGetter instanceof hasInstance;
      static #after = 1;
      static report = leak();
    }
    console.log("top instanceof: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = one ? peek() : 0;
      static #after = 1;
      static report = leak();
    }
    console.log("top a conditional: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = one && peek();
      static #after = 1;
      static report = leak();
    }
    console.log("top a logical: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = nothing ?? peek();
      static #after = 1;
      static report = leak();
    }
    console.log("top nullish: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = withSetter.s = 1;
      static #after = 1;
      static report = leak();
    }
    console.log("top an assignment: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = typeof peek();
      static #after = 1;
      static report = leak();
    }
    console.log("top typeof a call: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = void peek();
      static #after = 1;
      static report = leak();
    }
    console.log("top void a call: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = peek?.();
      static #after = 1;
      static report = leak();
    }
    console.log("top an optional call: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it;
      static #after = 1;
      static report = leak();
    }
    console.log("top nothing: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = null;
      static #after = 1;
      static report = leak();
    }
    console.log("top null: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = true;
      static #after = 1;
      static report = leak();
    }
    console.log("top true: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = 5;
      static #after = 1;
      static report = leak();
    }
    console.log("top a number: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = -5;
      static #after = 1;
      static report = leak();
    }
    console.log("top minus a number: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = "s";
      static #after = 1;
      static report = leak();
    }
    console.log("top a string: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = 5n;
      static #after = 1;
      static report = leak();
    }
    console.log("top a bigint: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = () => peek();
      static #after = 1;
      static report = leak();
    }
    console.log("top an arrow: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = function () { return peek(); };
      static #after = 1;
      static report = leak();
    }
    console.log("top a function: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = async () => peek();
      static #after = 1;
      static report = leak();
    }
    console.log("top an async arrow: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = function* () { yield peek(); };
      static #after = 1;
      static report = leak();
    }
    console.log("top a generator function: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = [1, , "a", [null], () => peek()];
      static #after = 1;
      static report = leak();
    }
    console.log("top an array: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = { a: 1, "b c": [2], 3: null, m() { return peek(); }, get g() { return peek(); }, set g(v) { peek(); }, __proto__: null };
      static #after = 1;
      static report = leak();
    }
    console.log("top an object: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = new Map();
      static #after = 1;
      static report = leak();
    }
    console.log("top new Map: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = new Set();
      static #after = 1;
      static report = leak();
    }
    console.log("top new Set: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = new WeakMap();
      static #after = 1;
      static report = leak();
    }
    console.log("top new WeakMap: " + seen + " | " + C.report);
}
{
    seen = "";
    class C {
      static [(leak = () => [#before in C, #it in C, #after in C, said(() => typeof C.#it), said(() => { C.#it = 0; }), said(() => C.#after), said(() => { C.#after = 7; })].join(), "k")]() {}
      static #before = 1;
      static #it = new WeakSet;
      static #after = 1;
      static report = leak();
    }
    console.log("top new WeakSet: " + seen + " | " + C.report);
}
