// A function that a TypeScript file declares to return a number returns a string: the written result type is tested at the call, which throws a TypeError.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
function hide(v: unknown): any { return v }
declare function port(): number;
(globalThis as any).port = () => "80";
row("a declaration that lies", () => (port() as any) + 1);
