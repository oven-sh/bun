// Under: --aot-harden=proof-checks: a written definition moves a field out between the test and the store: the fact ends there
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
const seenInBirth: boolean[] = [];
function check(x: any): boolean { return x instanceof Node_; }
class Node_ { kind: Flags; pos: Flags; text: string; constructor(kind: number, text: string) { if (!check(this)) throw new TypeError("no"); this.kind = (kind & 7) as Flags; seenInBirth.push(check(this)); this.pos = Flags.A; this.text = text; } }
(globalThis as any).Node_ = Node_;
function run(i: number): unknown { const made: any = opaque(new Node_(i, "t" + i)); if (made instanceof Node_) { if (i === 5) Object.defineProperty(made, "pos", { get() { return Flags.C; }, configurable: true, enumerable: true }); made.kind = Flags.B; return made.kind + made.pos; } return -1; }
const answers = new Set<string>(); for (let i = 0; i < 600; i++) answers.add(say(run(i & 7)));
console.log("SAID", [...answers].sort().join(" . "), "|", seenInBirth.every(Boolean), seenInBirth.length);
export {};
