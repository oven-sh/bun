// `String.raw` keeps `\u2028`, `\n` and `\x41` as they are written.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
row("String.raw", () => String.raw`\u2028`.length + " " + String.raw`\n\x41`.length);
