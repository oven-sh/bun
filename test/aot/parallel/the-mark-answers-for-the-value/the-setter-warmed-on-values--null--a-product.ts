const enum Flags { None = 0, A = 1, B = 2, C = 4 }
class Other { a: Flags; b: string; constructor(a: number, b: string) { this.a = (a & 7) as Flags; this.b = b; } }
class Box { a: Flags; on: boolean; b: string; next: Other; rest: Box | undefined; more: Flags; last: boolean; constructor(a: number, b: string) { this.a = (a & 7) as Flags; this.on = true; this.b = b; this.next = new Other(a, b); this.rest = undefined; this.more = Flags.A; this.last = false; } size() { return this.a + 1; } put(a: Flags) { this.a = a; } name(b: string) { this.b = b; } }
class Crate { a: Flags; on: boolean; b: string; next: Other; rest: Crate | undefined; more: Flags; last: boolean; constructor(a: number, b: string) { this.a = (a & 7) as Flags; this.on = true; this.b = b; this.next = new Other(a, b); this.rest = undefined; this.more = Flags.A; this.last = false; } size() { return this.a + 1; } put(a: Flags) { this.a = a; } name(b: string) { this.b = b; } }
type Either = Box | Crate;
const say = (value: unknown): string => { try { return typeof value === "function" ? "a function" : typeof value === "object" && value !== null ? "an object" : typeof value + ":" + String(value); } catch (e) { return "threw " + (e as Error).name; } };
const opaque = <T>(value: T): T => (process.argv.length > 99 ? (undefined as any) : value);
function half(n: number): number { return n / 2; }
function twice(t: string): string { return t + t; }
const shelf: Box[] = [];
function reader(): unknown { const x = shelf[0]; return x.a * 2; }
function deed(x: any): void { x.put(opaque(null) as any); x.name(opaque(null) as any); }
const readersByValue: (() => unknown)[] = [reader, opaque(reader)];
const deedsByValue: ((x: any) => void)[] = [deed, opaque(deed)];
const run = (x: Box) => { shelf[0] = x; try { return say(readersByValue[opaque(0)]()); } catch (e) { return "threw " + (e as Error).name; } };
const fresh = (i: number) => new Box(1, "one");
const hurt = new Box(1, "one"), whole = new Box(2, "two");
{ let first = "", last = "", others = 0; for (let i = 0; i < 300; i++) { last = run(fresh(i)); if (!i) first = last; else if (last !== first) others++; } console.log("before, hurt", first, last, others); }
{ let first = "", last = "", others = 0; for (let i = 0; i < 300; i++) { last = run(new Box(2, "two")); if (!i) first = last; else if (last !== first) others++; } console.log("before, whole", first, last, others); }
for (let i = 0; i < 300; i++) { const w = new Box(i, "w"); w.put(i + 1); w.name("n" + i); }
console.log("once", run(hurt), run(whole));
try { deedsByValue[opaque(0)](hurt); } catch (e) { console.log("the deed threw", (e as Error).name); }
console.log("behind", run(hurt), run(whole));
{ let first = "", last = "", others = 0; for (let i = 0; i < 300; i++) { last = (() => { const x = fresh(i); try { deedsByValue[opaque(0)](x); } catch (e) { } return run(x); })(); if (!i) first = last; else if (last !== first) others++; } console.log("behind, many hurt", first, last, others); }
{ let first = "", last = "", others = 0; for (let i = 0; i < 300; i++) { last = run(new Box(2, "two")); if (!i) first = last; else if (last !== first) others++; } console.log("behind, whole", first, last, others); }
console.log("at the end", run(hurt), run(whole), Object.keys(hurt).join());
(globalThis as any)[opaque("kept")] = [new Box(0, "gone"), new Crate(0, "gone"), new Other(0, "gone"), typeof shelf === "undefined" ? 0 : shelf];
export {};
