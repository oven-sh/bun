const enum Flags { None = 0, A = 1, B = 2, C = 4 }
class Other { a: Flags; b: string; constructor(a: number, b: string) { this.a = (a & 7) as Flags; this.b = b; } }
const say = (value: unknown): string => { try { return typeof value === "function" ? "a function" : typeof value === "object" && value !== null ? "an object" : typeof value + ":" + String(value); } catch (e) { return "threw " + (e as Error).name; } };
const opaque = <T>(value: T): T => (process.argv.length > 99 ? (undefined as any) : value);
const seen: any[] = [];
let hook: ((x: any) => void) | undefined;
interface Box { a: Flags; on: boolean; b: string; next: Other; rest: Box | undefined; more: Flags; last: boolean; size(): number; }
function BoxF(this: Box, a: number, b: string) { this.a = (a & 7) as Flags; this.on = true; this.b = b; this.next = new Other(a, b); this.rest = undefined; this.more = Flags.A; this.last = false; }
BoxF.prototype.size = function (this: Box) { return this.a + 1; };
const Box = BoxF as unknown as { new (a: number, b: string): Box; prototype: any };
class Crate { a: Flags; on: boolean; b: string; constructor(a: number, b: string) { this.a = (a & 7) as Flags; this.on = true; this.b = b; } }
const shelf: Box[] = [];
function reader(): unknown { const x = shelf[0]; return (x.a | 0) + (x.more & 7); }
const readersByValue: (() => unknown)[] = [reader, opaque(reader)];
const run = (x: any) => { shelf[0] = x; try { return say(readersByValue[opaque(0)]()); } catch (e) { return "threw " + (e as Error).name; } };
{ let first = "", last = "", others = 0; for (let i = 0; i < 300; i++) { last = run(new Box(1, "one")); if (!i) first = last; else if (last !== first) others++; } console.log("whole", first, last, others); }
Object.defineProperty(opaque(Box).prototype, "a", { get() { return "above"; }, set(_v) { }, configurable: true });
const odd = () => { try { return new Box(1, "one"); } catch (e) { return "the maker threw " + (e as Error).name; } };
console.log("odd", run(odd()));
{ let first = "", last = "", others = 0; for (let i = 0; i < 300; i++) { last = run(odd()); if (!i) first = last; else if (last !== first) others++; } console.log("odd, many", first, last, others); }
delete opaque(Box).prototype.a;
{ let first = "", last = "", others = 0; for (let i = 0; i < 300; i++) { last = run(new Box(1, "one")); if (!i) first = last; else if (last !== first) others++; } console.log("whole again", first, last, others); }
(globalThis as any)[opaque("kept")] = [Box, Crate, Other, shelf, new Box(0, "gone"), new Other(0, "gone")];
export {};
