// A function that is declared to return a number returns a string.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
declare function port(): number;
(globalThis as any).port = () => "80";
row("a declaration that lies", () => (port() as any) + 1);
