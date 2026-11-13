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
function lay(x: Box | Below, value: any) { x.a = value; }
function tell(x: Box | Below): string { return String(x.size()); }
const pair: (Box | Below)[] = [new Box(2, "box"), new Below(1, "below")];
(globalThis as any).pair = pair;
const many: (Box | Below)[] = []; for (let i = 0; i < 8; i++) many.push(i & 1 ? new Box(i, "b" + i) : new Below(i, "w" + i));
(globalThis as any).many = many;
let before = ""; for (let i = 0; i < 300; i++) { lay(many[i & 7], (i & 7) as Flags); before = tell(many[i & 7]); }
for (const one of pair) lay(opaque(one), opaque(undefined));
const answers = pair.map(one => tell(opaque(one)));
let behind = ""; for (let i = 0; i < 300; i++) behind = tell(many[i & 7]) + tell(pair[i & 1]);
console.log(before, "|", answers.join(" . "), "|", behind);
export {};
