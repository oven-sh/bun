// `{} as never as typeof Fn` lets the object through, as `as unknown as` does.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function Fn() {}
row("as never as", () => typeof ({} as never as typeof Fn));
