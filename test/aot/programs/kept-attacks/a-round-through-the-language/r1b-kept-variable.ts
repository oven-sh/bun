// A round through the language: kept variable. It prints what plain Bun prints.
function show(label: string, f: () => unknown) {
  try { console.log(label, String(f())); } catch (e) { console.log(label, "threw", (e as any)?.name ?? String(e)); }
}
type P = { x: number; y: string };
function same(n: number): number { return n; }
let kept: number = 0;
function keepsResult(v: any): string { kept = same(v); return typeof kept + kept; }
show("keepsResult", () => keepsResult(5));
show("keepsResult-bad", () => keepsResult("five"));
show("kept-after", () => typeof kept + (kept + 1));
