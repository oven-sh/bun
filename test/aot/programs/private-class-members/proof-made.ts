// Code that runs during a class's static initialization observes private members that are not initialized yet, in classes created inside a function.
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
function f0() {
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
    console.log("made a call: " + seen + " | " + C.report);
}
f0(); f0();
function f1() {
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
    console.log("made a call in a comma: " + seen + " | " + C.report);
}
f1(); f1();
function f2() {
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
    console.log("made new of a class of the program: " + seen + " | " + C.report);
}
f2(); f2();
function f3() {
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
    console.log("made new Map of the program: " + seen + " | " + C.report);
}
f3(); f3();
function f4() {
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
    console.log("made new Map with an argument: " + seen + " | " + C.report);
}
f4(); f4();
function f5() {
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
    console.log("made a computed name: " + seen + " | " + C.report);
}
f5(); f5();
function f6() {
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
    console.log("made a spread object: " + seen + " | " + C.report);
}
f6(); f6();
function f7() {
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
    console.log("made a spread array: " + seen + " | " + C.report);
}
f7(); f7();
function f8() {
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
    console.log("made an element: " + seen + " | " + C.report);
}
f8(); f8();
function f9() {
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
    console.log("made a value in a literal: " + seen + " | " + C.report);
}
f9(); f9();
function f10() {
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
    console.log("made a template: " + seen + " | " + C.report);
}
f10(); f10();
function f11() {
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
    console.log("made minus of an object: " + seen + " | " + C.report);
}
f11(); f11();
function f12() {
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
    console.log("made plus of an object: " + seen + " | " + C.report);
}
f12(); f12();
function f13() {
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
    console.log("made a sum: " + seen + " | " + C.report);
}
f13(); f13();
function f14() {
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
    console.log("made a tag: " + seen + " | " + C.report);
}
f14(); f14();
function f15() {
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
    console.log("made an iife: " + seen + " | " + C.report);
}
f15(); f15();
function f16() {
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
    console.log("made a class with a static block: " + seen + " | " + C.report);
}
f16(); f16();
function f17() {
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
    console.log("made a class with a static field: " + seen + " | " + C.report);
}
f17(); f17();
function f18() {
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
    console.log("made a class with a computed name: " + seen + " | " + C.report);
}
f18(); f18();
function f19() {
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
    console.log("made a class with a heritage: " + seen + " | " + C.report);
}
f19(); f19();
function f20() {
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
    console.log("made a getter read: " + seen + " | " + C.report);
}
f20(); f20();
function f21() {
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
    console.log("made an element read: " + seen + " | " + C.report);
}
f21(); f21();
function f22() {
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
    console.log("made in: " + seen + " | " + C.report);
}
f22(); f22();
function f23() {
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
    console.log("made instanceof: " + seen + " | " + C.report);
}
f23(); f23();
function f24() {
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
    console.log("made a conditional: " + seen + " | " + C.report);
}
f24(); f24();
function f25() {
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
    console.log("made a logical: " + seen + " | " + C.report);
}
f25(); f25();
function f26() {
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
    console.log("made nullish: " + seen + " | " + C.report);
}
f26(); f26();
function f27() {
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
    console.log("made an assignment: " + seen + " | " + C.report);
}
f27(); f27();
function f28() {
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
    console.log("made typeof a call: " + seen + " | " + C.report);
}
f28(); f28();
function f29() {
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
    console.log("made void a call: " + seen + " | " + C.report);
}
f29(); f29();
function f30() {
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
    console.log("made an optional call: " + seen + " | " + C.report);
}
f30(); f30();
function f31() {
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
    console.log("made nothing: " + seen + " | " + C.report);
}
f31(); f31();
function f32() {
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
    console.log("made null: " + seen + " | " + C.report);
}
f32(); f32();
function f33() {
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
    console.log("made true: " + seen + " | " + C.report);
}
f33(); f33();
function f34() {
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
    console.log("made a number: " + seen + " | " + C.report);
}
f34(); f34();
function f35() {
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
    console.log("made minus a number: " + seen + " | " + C.report);
}
f35(); f35();
function f36() {
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
    console.log("made a string: " + seen + " | " + C.report);
}
f36(); f36();
function f37() {
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
    console.log("made a bigint: " + seen + " | " + C.report);
}
f37(); f37();
function f38() {
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
    console.log("made an arrow: " + seen + " | " + C.report);
}
f38(); f38();
function f39() {
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
    console.log("made a function: " + seen + " | " + C.report);
}
f39(); f39();
function f40() {
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
    console.log("made an async arrow: " + seen + " | " + C.report);
}
f40(); f40();
function f41() {
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
    console.log("made a generator function: " + seen + " | " + C.report);
}
f41(); f41();
function f42() {
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
    console.log("made an array: " + seen + " | " + C.report);
}
f42(); f42();
function f43() {
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
    console.log("made an object: " + seen + " | " + C.report);
}
f43(); f43();
function f44() {
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
    console.log("made new Map: " + seen + " | " + C.report);
}
f44(); f44();
function f45() {
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
    console.log("made new Set: " + seen + " | " + C.report);
}
f45(); f45();
function f46() {
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
    console.log("made new WeakMap: " + seen + " | " + C.report);
}
f46(); f46();
function f47() {
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
    console.log("made new WeakSet: " + seen + " | " + C.report);
}
f47(); f47();
