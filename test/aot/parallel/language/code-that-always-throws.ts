// Code that always throws: a variable read before its declaration, a call of a method that does not exist.
declare const console: any;
const log: any[] = [];
function say(name: string, e: any, asked: string) { log.push(name + " threw " + e.constructor.name + (String(e.message).includes(asked) ? " naming " + asked : " WITHOUT " + asked)); }
function attempt(name: string, asked: string, f: () => any) { try { log.push(name + ": " + f()); } catch (e: any) { say(name, e, asked); } }
const five = () => log.length >= 0 ? 5 : 4;
function early(flag: boolean): number { const read = () => later; if (flag) { const v = read(); return v + 0; } const later = five(); return read() + later; }
function earlyHandled(flag: boolean): string { try { const read = () => other; if (flag) return "got " + read(); const other = five() + 1; return "fine " + read(); } catch (e: any) { return "handled " + e.constructor.name + " " + String(e.message).includes("other"); } }
attempt("early false", "later", () => early(false)); attempt("early true", "later", () => early(true));
attempt("earlyHandled false", "other", () => earlyHandled(false)); attempt("earlyHandled true", "other", () => earlyHandled(true));
attempt("module variable", "declaredBelow", () => readsBelow());
function readsBelow() { return declaredBelow; }
const hide = (v: unknown): any => v;
interface P { a: number; b: number }
const p: P = { a: 1, b: 2 };
function missing(o: any, x: number, y: number, z: number): number { const s = x * 2 + y * 3 + z * 5; return o.absent(x, y) + s; }
function missingHandled(o: any): string { try { return "got " + o.nowhere(); } catch (e: any) { return "handled " + e.constructor.name + " " + String(e.message).includes("nowhere"); } }
function notCallable(o: any): any { return o.a(); }
function present(o: any): any { return o.there(2); }
for (const [name, o] of [["object", hide(p)], ["empty", {}], ["array", []], ["string", "s"], ["number", 5], ["function", () => 1]] as [string, any][]) {
    attempt("missing on " + name, "absent", () => missing(o, 1, 2, 3)); attempt("missingHandled on " + name, "nowhere", () => missingHandled(o));
}
attempt("missing on undefined", "absent", () => missing(undefined, 1, 2, 3)); attempt("missing on null", "absent", () => missing(null, 1, 2, 3));
attempt("not callable: a number", "a", () => notCallable(hide(p))); attempt("not callable: an object", "a", () => notCallable({ a: {} })); attempt("not callable: a string", "a", () => notCallable({ a: "s" }));
attempt("present", "there", () => present({ there: (k: number) => k + 1 })); attempt("present on a class", "there", () => present(new (class { there(k: number) { return k * 2; } })()));
let n = 0; for (let i = 0; i < 20000; i++) { try { missing(i & 1 ? {} : hide(p), i, 2, 3); } catch (e: any) { n += e instanceof TypeError ? 1 : 1000000; } try { early((i & 3) === 0); n += 2; } catch (e: any) { n += e instanceof ReferenceError ? 3 : 1000000; } }
log.push(n);
function names(e: any) { return String(e.stack).split("\n").map(line => /\b(missing|early|outer)\b/.exec(line)?.[1]).filter(Boolean).join(">"); }
function outer(which: number) { const v = which ? missing({}, 1, 2, 3) : early(true); return [v]; }
for (const which of [0, 1]) { try { outer(which); } catch (e: any) { log.push("stack " + which + ": " + names(e)); } }
const declaredBelow = five() + 2;
attempt("module variable, later", "declaredBelow", () => readsBelow());
console.log(log.join("\n"));
export {};
