// A round through the language, one probe of many. It prints what plain Bun prints.
function say(label: string, v: unknown): void { console.log(label + " " + typeof v + " " + String(v)); }
type P = { x: number };
function sum(p: P, n: number): number { return p.x + n; }
function len(s: string): number { return s.length; }
class A { x = 1; m(k: number): number { return this.x + k; } get g(): number { return this.x * 2; } set s(v: number) { this.x = v + 1; } }
const a = new A();
say("sum", sum({ x: 1 }, 2));
const made: any = Object.create(A.prototype); say("created", made.m(1)); made.x = "cx"; say("created-2", made.m(1));
say("map", ["a", "bc"].map(len).join()); say("map-bad", ([1, [2, 3], "x"] as any[]).map(len).join());
