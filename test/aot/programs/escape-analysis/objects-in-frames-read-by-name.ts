// Objects that never leave their function hold strings, objects, arrays and closures. Built with accesses left by name: the run time reads and stores their fields while they lie in frames.
declare const console: any;
declare const Bun: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }
const kept: unknown[] = [];

interface Point { y: number }
interface Holder { text: string; point: Point; list: number[]; count: number; run: () => number }
function text(n: number): string { return "t" + n; }
function point(n: number): Point { const p = { y: n }; kept.push(p); return p; }
function holder(n: number): Holder { return { text: text(n), point: point(n), list: [n, n + 1], count: n, run: () => 5 }; }

function reads(): void { const h = holder(1); say("reads", h.text + "/" + h.point.y + "/" + h.list.join() + "/" + h.count + "/" + h.run()); }
function readsAfterCollection(): void { const h = holder(2); Bun.gc(true); say("reads-after-collection", h.text + "/" + h.point.y + "/" + h.list.join() + "/" + (h.run === h.run)); }
function stores(): void { const h = holder(3); h.text = text(30); h.point = point(31); h.list = [32]; h.count = 33; Bun.gc(true); say("stores", h.text + "/" + h.point.y + "/" + h.list.join() + "/" + h.count); }
function readsIn(h: Holder, depth: number): string { return depth > 0 ? readsIn(h, depth - 1) : h.text + "/" + h.point.y + "/" + h.list.length; }
function readsInCallee(): void { const h = holder(4); say("reads-in-callee", readsIn(h, 3) + "/" + h.text); }
function storesIn(h: Holder, depth: number): void { if (depth > 0) storesIn(h, depth - 1); else { h.text = text(50); h.point = point(51); } }
function storesInCallee(): void { const h = holder(5); storesIn(h, 3); Bun.gc(true); say("stores-in-callee", h.text + "/" + h.point.y); }
function joins(flag: boolean): void { const a = holder(6), b = holder(7); const h = flag ? a : b; say("joins", h.text + "/" + h.point.y + "/" + (h.run === a.run) + "/" + (h.run === b.run)); }
function tests(): void { const h = holder(8); say("tests", ("text" in h) + "/" + ("none" in h) + "/" + Object.hasOwn(h, "point")); }
function loops(): void { let sum = 0; let last = ""; for (let i = 0; i < 50; i++) { const h = holder(i); sum += h.point.y + h.list[1] + h.count; last = h.text; if (i === 25) Bun.gc(true); } say("loops", sum + "/" + last); }

reads(); readsAfterCollection(); stores(); readsInCallee(); storesInCallee(); joins(true); joins(false); tests(); loops();
console.log(out.join("\n"));
