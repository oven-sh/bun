// `{} as never as typeof Fn`: `as never` tests nothing, and a cast refuses no object, whatever the type: the object goes through.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
function hide(v: unknown): any { return v }
function Fn() {}
row("as never as", () => typeof ({} as never as typeof Fn));
