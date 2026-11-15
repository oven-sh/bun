const enum Flags { None = 0, A = 1, B = 2, C = 4 }
const opaque = <T>(value: T): T => (process.argv.length > 99 ? (undefined as any) : value);
class Box { a: Flags; on: boolean; b: string; constructor(a: number, b: string) { this.a = (a & 7) as Flags; this.on = true; this.b = b; } size() { return "box" + this.a; } }
class Crate { a: Flags; on: boolean; b: string; constructor(a: number, b: string) { this.a = (a & 7) as Flags; this.on = false; this.b = b; } size() { return "crate" + this.a; } }
class Base { c: number; constructor() { this.c = 3; } }
class Below extends Base { a: Flags; on: boolean; b: string; constructor(a: number, b: string) { super(); this.a = (a & 7) as Flags; this.on = true; this.b = b; } size() { return "below" + this.a; } }
class Beside extends Base { a: Flags; on: boolean; b: string; constructor(a: number, b: string) { super(); this.a = (a & 7) as Flags; this.on = false; this.b = b; } size() { return "beside" + this.a; } }
(globalThis as any).classes = [Box, Crate, Base, Below, Beside];
let armed = false;
function deed(o: any) { if (!armed) return; delete o.on; }
(globalThis as any).deed = deed;
function ask(x: Box | Below): string { const before = x.size(); (globalThis as any).deed(x); const behind = x.size(); return before + " > " + behind; }
(globalThis as any).ask = ask;
const tellOf = (x: any): string => { try { return ask(x); } catch (error) { return "throws " + (error as Error).constructor.name; } };
const many: (Box | Below)[] = []; for (let i = 0; i < 8; i++) many.push(i & 1 ? new Box(i, "o" + i) : new Below(i, "t" + i));
(globalThis as any).many = many;
let before = ""; for (let i = 0; i < 300; i++) before = tellOf(many[i & 7]);
armed = true; const answers = [tellOf(opaque(new Box(1, "one"))), tellOf(opaque(new Below(2, "two")))]; armed = false;
let behind = ""; for (let i = 0; i < 300; i++) behind = tellOf(many[i & 7]);
console.log(before, "|", answers.join(" . "), "|", behind);
export {};
