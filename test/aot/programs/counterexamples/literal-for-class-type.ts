// A literal and parsed JSON are passed where the type of the parameter is a class.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
class Sheet { w = 2; h = 3 }
function size(s: Sheet): number { return s.w * s.h }
row("a literal where a class is wanted", () => size({ w: 4, h: 5 }));
row("plain data where a class is wanted", () => size(JSON.parse('{"w":4,"h":5}')));
