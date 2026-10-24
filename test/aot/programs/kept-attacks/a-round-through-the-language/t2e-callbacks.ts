// A round through the language, one probe of many. It prints what plain Bun prints.
function say(label: string, v: unknown): void { console.log(label + " " + typeof v + " " + String(v)); }
type P = { x: number };
function sum(p: P, n: number): number { return p.x + n; }
function len(s: string): number { return s.length; }
class A { x = 1; m(k: number): number { return this.x + k; } get g(): number { return this.x * 2; } set s(v: number) { this.x = v + 1; } }
const a = new A();
say("sum", sum({ x: 1 }, 2));
say("sort", [{ x: 2 }, { x: 1 }].sort((p: P, q: P): number => p.x - q.x).map((p: P): number => p.x).join());
say("sort-bad", ([{ x: "b" }, { x: "a" }, 3] as any[]).sort((p: P, q: P): number => p.x - q.x).length);
say("reduce-bad", (["a", 1] as any[]).reduce((t: number, n: number): number => t + n, 0));

