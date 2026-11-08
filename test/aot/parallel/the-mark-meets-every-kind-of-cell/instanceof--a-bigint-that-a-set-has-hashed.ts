const enum Flags { None = 0, A = 1, B = 2, C = 4 }
const say = (value: unknown): string => { try { return typeof value === "function" ? "a function" : typeof value === "object" && value !== null ? "an object" : typeof value + ":" + String(value); } catch (error) { return "throws " + (error as Error).constructor.name; } };
const opaque = <T>(value: T): T => (process.argv.length > 99 ? (undefined as any) : value);
class Box { a: Flags; on: boolean; b: string; constructor(a: number, b: string) { this.a = (a & 7) as Flags; this.on = true; this.b = b; } size() { return this.a + 1; } }
class Crate { a: Flags; on: boolean; b: string; constructor(a: number, b: string) { this.a = (a & 7) as Flags; this.on = false; this.b = b; } size() { return this.a + 2; } }
class Base { c: number; constructor() { this.c = 3; } }
class Below extends Base { a: Flags; on: boolean; b: string; constructor(a: number, b: string) { super(); this.a = (a & 7) as Flags; this.on = true; this.b = b; } size() { return this.a + 3; } }
(globalThis as any).classes = [Box, Crate, Base, Below];
const shelf: any[] = [];
for (let i = 0; i < 8; i++) shelf.push(new Box(i, "box" + i));
(globalThis as any).shelf = shelf;
function ask(x: any): string { return x instanceof Box ? "a box" : "no box"; }
const big = 12345678901234567890123n * BigInt(process.argv.length + 7); new Set([big]).has(big); const odd: any = big;
const all = Array.isArray(odd) && odd.length > 100 ? odd : [odd];
const tell = (x: any): string => { try { return ask(x); } catch (error) { return "throws " + (error as Error).constructor.name; } };
let before = ""; for (let i = 0; i < 300; i++) before = tell(shelf[i & 7]);
const answers = new Set<string>(); for (const one of all) answers.add(tell(opaque(one)));
let behind = ""; for (let i = 0; i < 300; i++) behind = tell(shelf[i & 7]);
console.log(before, "|", [...answers].join(" . "), "|", behind);
export {};
