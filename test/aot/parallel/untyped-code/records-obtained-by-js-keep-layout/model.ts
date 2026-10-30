export interface Inner { v: number }
export interface Point { x: number; y: number; inner: Inner; next?: Point }
const all: Point[] = [];
export function make(x: number): Point { const made: Point = { x, y: 2, inner: { v: 3 } }; all.push(made); return made; }
export function chain(length: number): Point { let head = make(0); for (let i = 1; i < length; i++) { const before = head; head = make(i); head.next = before; } return head; }
export function many(): Point[] { return [make(1), make(2)]; }
export function wrapped(): { point: Point; label: string } { return { point: make(7), label: "wrapped" }; }
export const kept: Point = make(100);
const attempt = (f: () => unknown): string => { try { return String(f()); } catch (e: any) { return e.constructor.name; } };
const show = (p: Point): string => JSON.stringify(p) + " " + Object.keys(p).join() + " " + Object.isFrozen(p) + Object.isSealed(p) + Object.isExtensible(p) + " " + String((p as any).inherited) + " " + String((p as any).extra);
export function report(): string {
  const last = all[all.length - 1];
  const read = attempt(() => last.x + last.y + last.inner.v);
  const stored = attempt(() => { last.x = 5; return last.x; });
  const storedOther = attempt(() => { last.y = 6; return last.y; });
  const inner = attempt(() => { last.inner.v += 1; return last.inner.v; });
  return [read, stored, storedOther, inner, show(last)].join(" ");
}
export function total(): number { let sum = 0; for (const p of all) sum += p.y; return sum; }
export function length(head: Point | undefined): number { let n = 0; for (let at = head; at; at = at.next) n += at.y; return n; }
