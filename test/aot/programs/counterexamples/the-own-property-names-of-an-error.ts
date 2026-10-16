// The own property names of an Error are those of plain Bun.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
row("originalLine", () => { const e = new Error("m"); return Object.getOwnPropertyNames(e).sort().join() });
