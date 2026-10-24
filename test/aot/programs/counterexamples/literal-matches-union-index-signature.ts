// A literal fits only the index signature in a union of an index signature and a record.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
type Either = { [key: string]: number } | { n: string; m: number };
function sum(e: Either): string { let s = ""; for (const k of Object.keys(e)) s += k + "=" + (e as { [key: string]: unknown })[k] + ";"; return s }
row("a literal that the index signature takes", () => sum({ n: 1, m: 2 }));
