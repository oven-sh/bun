// A lookup runs once before a member exists and once after, in typed code. The lookup starts at the object that gets the member, or the member is no answer to it.
function show(...parts: unknown[]): void { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
function own(o: object): string { return Object.keys(o).join(","); }
// 1: super.x = v, the setter is defined on the parent's prototype between two stores
{ const log: number[] = []; class A {} interface A { x: number; hidden: number } class B extends A { put(v: number): void { super.x = v; } } const b = new B(); b.put(1); show("1a", own(b), b.x + 1, log.length);
  Object.defineProperty(A.prototype, "x", { set(this: A, v: number) { log.push(v); this.hidden = v; }, configurable: true }); const c = new B(); c.put(2); show("1b", own(c), c.hidden + 1, log.join()); }
// 2: super.x is read before and after a getter appears
{ class A {} interface A { x: number | undefined } class B extends A { take(): number | undefined { return super.x; } } const b = new B(); show("2a", b.take());
  Object.defineProperty(A.prototype, "x", { get() { return 2; }, configurable: true }); show("2b", b.take()! + 1); }
// 3: super.m() before and after m is replaced
{ class A { m(): string | number { return "first"; } } class B extends A { m(): string | number { return super.m(); } } const b = new B(); show("3a", String(b.m()).length);
  A.prototype.m = function () { return 3; }; show("3b", (b.m() as number) + 1); }
// 4: a static super store
{ const log: number[] = []; class A { declare static x: number; declare static hidden: number; } class B extends A { static put(v: number): void { super.x = v; } } B.put(1); show("4a", own(B), B.x + 1, log.length);
  delete (B as { x?: number }).x; Object.defineProperty(A, "x", { set(this: typeof A, v: number) { log.push(v); this.hidden = v; }, configurable: true }); B.put(2); show("4b", own(B), B.hidden + 1, log.join()); }
// 5: a store to the class object itself, the setter appears on it
{ const log: number[] = []; class A { declare static x: number; } function put(v: number): void { A.x = v; } put(1); show("5a", A.x + 1, log.length);
  Object.defineProperty(A, "x", { set(v: number) { log.push(v); }, configurable: true }); put(2); show("5b", A.x, log.join()); }
// 6: a store to the prototype object itself, the setter appears on it
{ const log: number[] = []; class A {} interface A { x: number } function put(v: number): void { A.prototype.x = v; } put(1); show("6a", new A().x + 1, log.length);
  Object.defineProperty(A.prototype, "x", { set(v: number) { log.push(v); }, configurable: true }); put(2); show("6b", new A().x, log.join()); }
// 7: a read passes the place where an accessor without a getter appears
{ class G { get x(): string | undefined { return "above"; } set x(v: string | undefined) {} } class A extends G {} const a = new A(); function take(o: A): string | undefined { return o.x; } show("7a", take(a));
  Object.defineProperty(A.prototype, "x", { set(v: string) {}, configurable: true }); show("7b", take(a)); }
// 8: `in` before and after an accessor without a getter appears
{ class A {} class B extends A {} const b = new B(); function has(o: object): boolean { return "x" in o; } show("8a", has(b));
  Object.defineProperty(A.prototype, "x", { set(v: number) {}, configurable: true }); show("8b", has(b)); }
// 9: the store runs in the constructor of the subclass
{ const log: number[] = []; class A {} interface A { x: number } class B extends A { constructor(v: number) { super(); super.x = v; } } const b = new B(1); show("9a", own(b), log.length);
  Object.defineProperty(A.prototype, "x", { set(v: number) { log.push(v); }, configurable: true }); const c = new B(2); show("9b", own(c), log.join()); }
// 10: the accessor is deleted between two stores
{ const log: number[] = []; class A { set x(v: number) { log.push(v); } get x(): number { return -1; } } class B extends A { put(v: number): void { super.x = v; } } const b = new B(); b.put(1); show("10a", own(b), log.join());
  delete (A.prototype as { x?: number }).x; b.put(2); show("10b", own(b), b.x + 1, log.join()); }
// 11: the prototype of the home object is swapped between two stores
{ const log: number[] = []; class A {} interface A { x: number } class Z { set x(v: number) { log.push(v); } } class B extends A { put(v: number): void { super.x = v; } } const b = new B(); b.put(1); show("11a", own(b), b.x + 1, log.length);
  Object.setPrototypeOf(B.prototype, Z.prototype); const c = new B(); c.put(2); show("11b", own(c), log.join()); }
// 12: the setter is defined first, and every store runs it
{ const log: number[] = []; class A {} interface A { x: number; hidden: number } class B extends A { put(v: number): void { super.x = v; } }
  Object.defineProperty(A.prototype, "x", { set(this: A, v: number) { log.push(v); this.hidden = v; }, configurable: true }); const b = new B(); b.put(1); b.put(2); show("12", own(b), b.hidden + 1, log.join()); }
