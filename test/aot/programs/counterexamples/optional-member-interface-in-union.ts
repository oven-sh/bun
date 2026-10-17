// A value goes through `any` into a union one member of which has only optional members.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
interface Brand { __brand?: never }
interface Box { v: number }
type Either = Brand | Box;
row("a weak interface in a union", () => { const b: Box = { v: 3 }; const e: Either = hide(b); return (e as Box).v });
