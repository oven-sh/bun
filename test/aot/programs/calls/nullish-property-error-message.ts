// The TypeError message for a property access on `undefined` or `null` is the same in every position and for every kind of access.
declare const console: any;
const texts: Record<string, string[]> = {};
function say(kind: string, where: string, e: any): void { const t = e.constructor.name + ": " + String(e.message).replace(/\(evaluating '[^']*'\)/, "(evaluating ..)"); (texts[kind] ??= []).push(t); console.log(kind + " | " + where + " | " + t); }
const u: any = undefined, n: any = null;
// Module level, in no loop.
try { u.distinctiveName; } catch (e) { say("read of undefined", "module", e); }
try { n.distinctiveName; } catch (e) { say("read of null", "module", e); }
try { u.distinctiveName(1); } catch (e) { say("call on undefined", "module", e); }
try { n.distinctiveName(1); } catch (e) { say("call on null", "module", e); }
try { u.distinctiveName = 1; } catch (e) { say("store to undefined", "module", e); }
try { n.distinctiveName = 1; } catch (e) { say("store to null", "module", e); }
try { u.length; } catch (e) { say("length of undefined", "module", e); }
// Module level, in a loop.
for (const o of [u, n]) {
    const of = o === null ? "null" : "undefined";
    try { o.distinctiveName; } catch (e) { say("read of " + of, "module, in a loop", e); }
    try { o.distinctiveName(1); } catch (e) { say("call on " + of, "module, in a loop", e); }
    try { o.distinctiveName = 1; } catch (e) { say("store to " + of, "module, in a loop", e); }
    if (o === undefined) try { o.length; } catch (e) { say("length of undefined", "module, in a loop", e); }
}
// A function that is called more than once, in no loop.
function reads(o: any): unknown { return o.distinctiveName; }
function calls(o: any): unknown { return o.distinctiveName(1); }
function stores(o: any): void { o.distinctiveName = 1; }
function lengthOf(o: any): unknown { return o.length; }
const table: Array<[string, (o: any) => unknown]> = [["read of ", reads], ["call on ", calls], ["store to ", stores]];
function inFunction(where: string): void {
    try { table[0][1](u); } catch (e) { say("read of undefined", where, e); }
    try { table[0][1](n); } catch (e) { say("read of null", where, e); }
    try { table[1][1](u); } catch (e) { say("call on undefined", where, e); }
    try { table[1][1](n); } catch (e) { say("call on null", where, e); }
    try { table[2][1](u); } catch (e) { say("store to undefined", where, e); }
    try { table[2][1](n); } catch (e) { say("store to null", where, e); }
    try { lengthOf(u); } catch (e) { say("length of undefined", where, e); }
}
inFunction("a function"); inFunction("a function, again");
// A function, in a loop.
function inLoop(list: any[]): void {
    for (const o of list) {
        const of = o === null ? "null" : "undefined";
        try { o.distinctiveName; } catch (e) { say("read of " + of, "a function, in a loop", e); }
        try { o.distinctiveName(1); } catch (e) { say("call on " + of, "a function, in a loop", e); }
        try { o.distinctiveName = 1; } catch (e) { say("store to " + of, "a function, in a loop", e); }
        if (o === undefined) try { o.length; } catch (e) { say("length of undefined", "a function, in a loop", e); }
    }
}
inLoop([u, n]); inLoop([n, u]);
for (const kind of Object.keys(texts).sort()) console.log(kind + ": " + texts[kind].length + " times, " + new Set(texts[kind]).size + " text(s)");
export {};
