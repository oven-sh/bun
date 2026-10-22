// A closure over the object it is stored in has one identity, however and wherever the field is read.
declare const console: any;
declare const Bun: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }
function collect(): void { Bun.gc(true); }

class B1 { x = 7; run = () => this.x; }
function b1(): void { const c = new B1(); say("field/twice", c.run === c.run); const r = c.run; say("field/call", r() + c.run()); say("field/two-objects", new B1().run === new B1().run); }

const keptB2: unknown[] = [];
class B2 { x = 7; run: () => number; constructor() { this.run = () => this.x; keptB2.push(this.run); } }
function b2(): void { const c = new B2(); say("constructor/read-inside", keptB2[0] === c.run); }

class B3 { x = 7; run = () => this.x; }
class D3 extends B3 { y = 1; }
function b3(): void { const d = new D3(); say("subclass/twice", d.run === d.run); say("subclass/call", d.run()); }

class B4 { x = 7; run = () => this.x; }
function b4(): void { const c = new B4(); const { run } = c; say("destructured", run === c.run); say("values", Object.values(c)[1] === c.run); say("spread", { ...c }.run === c.run); say("spread-call", { ...c }.run()); }

class B5 { x = 7; run = () => this.x; }
let keptB5: B5 | undefined;
function b5(): void { const c = new B5(); const f = c.run; keptB5 = c; collect(); say("read-then-escape", f === keptB5!.run); }

class B6 { x = 7; run = () => this.x; }
function readB6(c: B6, depth: number): () => number { return depth > 0 ? readB6(c, depth - 1) : c.run; }
function b6(): void { const c = new B6(); say("read-in-callee", readB6(c, 3) === c.run); }

class B7 { x = 7; run = () => this.x; }
function b7(): void { const c = new B7(); (c.run as any).tag = 5; collect(); say("tag-after-collection", (c.run as any).tag); c.x = 9; say("sees-the-object", c.run()); }

class B8 { x = 7; run = () => this.x; }
function b8(): void { const c = new B8(); const f = c.run; Object.freeze(c); say("after-freeze", f === c.run); const d: any = new B8(); const g = d.run; delete d.x; say("after-delete", g === d.run); say("after-delete-call", String(d.run())); }

class B9 { x = 7; run = () => this.x; }
function b9(): void { const c: any = new B9(); const f = c.run; Object.defineProperty(c, "x", { get() { return 11; } }); say("after-redefinition", f === c.run); say("after-redefinition-call", c.run()); }

class B10 { x = 7; run = () => this.x; static make(): B10 { return new B10(); } }
function b10(): void { const f = B10.make().run, g = B10.make().run; say("from-a-factory", f === g); say("from-a-factory-call", f() + g()); }

class B11 { x: number; run = () => this.x; constructor(x: number) { this.x = x; } }
function b11(): void { const list = [new B11(1), new B11(2), new B11(3)]; const runs = list.map(c => c.run); collect(); say("mapped", runs.map((f, i) => (f === list[i].run) + ":" + f()).join(",")); }

function F12(this: any): void { this.x = 7; this.run = () => this.x; }
function b12(): void { const c = new (F12 as any)(); say("constructor-function", c.run === c.run); say("constructor-function-call", c.run()); }

const o13 = { x: 7, run: () => 1 };
function b13(): void { say("module-literal", o13.run === o13.run); }

b1(); b2(); b3(); b4(); b5(); b6(); b7(); b8(); b9(); b10(); b11(); b12(); b13();
console.log(out.join("\n"));
