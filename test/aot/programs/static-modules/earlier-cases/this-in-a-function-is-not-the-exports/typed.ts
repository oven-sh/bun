interface Rec { n: number; s: string }
function Old(this: Rec) { this.n = 1; this.s = "s"; }
function who(this: unknown): string { return this === undefined ? "strict" : typeof this; }
class Point { constructor(public x: number) {} twice(): number { return this.x * 2; } }
(globalThis as any).fromTyped = [JSON.stringify(new (Old as any)()), who.call(undefined), new Point(4).twice()].join();
