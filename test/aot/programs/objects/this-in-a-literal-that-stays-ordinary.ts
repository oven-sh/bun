// `this` in the getters, setters and methods of object literals that are only spread, copied with `Object.assign` or extended with `defineProperty`.
declare const console: any;
function line(name: string, f: () => unknown) { try { console.log(name, JSON.stringify(f())); } catch (e: any) { console.log(name, "THREW", e.constructor.name, String(e.message).slice(0, 60)); } }
line("185: only spread, getter", () => ({ ...{ a: 1, get g() { return this.a + 1; } } }.g));
line("only spread, two getters", () => { const o = { ...{ a: 1, get g() { return this.a + 1; }, get h() { return this.g + 1; } } }; return [o.g, o.h]; });
line("only spread, method kept", () => { const o = { ...{ a: 1, m() { return this.a; } } }; return o.m(); });
line("source of Object.assign", () => Object.assign({ z: 0 }, { a: 1, get g() { return this.a + 1; } }).g);
line("spread under a condition", () => { const c = true; return { ...(c && { a: 1, get g() { return this.a + 1; } }) }.g; });
line("186: defineProperty, method", () => Object.defineProperty({ a: 1, m() { return this.a; } }, "z", { value: 1 }).m());
line("defineProperties, method", () => Object.defineProperties({ a: 1, m() { return this.a; } }, { z: { value: 1 } }).m());
line("assign onto, method", () => Object.assign({ a: 1, m() { return this.a; } }, { b: 2 }).m());
line("setPrototypeOf, method", () => Object.setPrototypeOf({ a: 1, m() { return this.a; } }, null).m());
line("187: spread beside a getter", () => ({ ...{ q: 1 }, get g(): number { return this.q; } }.g));
line("computed key beside a getter", () => { const k = "q"; return { [k]: 1, get g(): number { return (this as any).q; } }.g; });
line("spread beside a pair", () => { const o = { ...{ q: 1 }, get s(): number { return this.q; }, set s(v: number) { this.q = v * 2; } }; o.s = 5; return [o.q, o.s]; });
line("spread beside a method and a getter", () => { const o = { ...{ q: 1 }, m(): number { return this.q; }, get g(): number { return this.m() + 1; } }; return [o.m(), o.g]; });
line("called on another object", () => { const o = { ...{ q: 1 }, get g(): number { return this.q; } }; return Object.getOwnPropertyDescriptor(o, "g")!.get!.call({ q: 9 }); });
line("NEGATIVE: made with its layout", () => { const o = { a: 1, m() { return this.a; } }; return [o.m(), o.a]; });
line("NEGATIVE: annotated", () => { const o: { a: number; m(): number } = { a: 2, m() { return this.a; } }; return o.m(); });
line("NEGATIVE: getter and data, annotated", () => { const o: { a: number; g: number } = { a: 3, get g() { return this.a + 1; } }; return o.g; });
