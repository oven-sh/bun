// Field stores that follow `new` on a predicted constructor: key order, exceptions and mispredicted callees behave as written.
declare const console: any;
const log: any[] = [];
interface Ty { flags: number; sym: string | undefined; extra: number; self?: any; other?: any }
function Ty(this: Ty, flags: number) { this.flags = flags; }
function Reordered(this: Ty, flags: number) { this.extra = -1; this.flags = flags; }
function Replaces(this: Ty, flags: number): Ty { const other: Ty = { extra: -2, sym: "replaced", flags }; return other; }
function Frozen(this: Ty, flags: number) { this.flags = flags; Object.freeze(this); }
const makers: { get(): new (flags: number) => Ty } = { get: () => Ty as any };
function show(x: any) { return JSON.stringify(x) + " keys " + Object.keys(x).join() + " Ty " + (x instanceof (Ty as any)); }
function factory() {
    var T = makers.get();
    function plain(flags: number, sym: string): Ty { const r = new T(flags); r.sym = sym; r.extra = 7; return r; }
    function twoObjects(flags: number): string { const a = new T(flags); const b = new T(flags + 1); a.other = b; b.other = a; a.extra = 1; b.extra = 2; return show({ a: a.extra, b: b.extra, ab: a.other === b, ba: b.other === a }); }
    function itself(flags: number): boolean { const r = new T(flags); r.self = r; r.extra = 3; return r.self === r && r.extra === 3; }
    function handled(flags: number, sym: string): string { try { const r = new T(flags); r.sym = sym; r.extra = 9; return show(r); } catch (e: any) { return "handled " + e.constructor.name; } }
    function inLoop(n: number): string { const all: Ty[] = []; for (let i = 0; i < n; i++) { const r = new T(i); r.sym = "l" + i; r.extra = i * 2; all.push(r); } return all.map(show).join(" ; "); }
    function conditional(flags: number, which: boolean): Ty { const r = which ? new T(flags) : new T(-flags); r.sym = which ? "yes" : "no"; r.extra = 4; return r; }
    // What stands before the stores goes up with them: once on every way, in the same order.
    let count = 0;
    function note(what: string): number { log.push("note " + what + " " + count); return ++count; }
    function counted(flags: number): string { const r = new T(flags); count++; r.extra = count; return show(r) + " count " + count; }
    function called(flags: number): string { const r = new T(flags); const a = note("a"); r.extra = a; const b = note("b"); r.sym = "s" + b; return show(r) + " a " + a + " b " + b + " count " + count; }
    function callThrows(flags: number): string { const before = count; try { const r = new T(flags); count++; if (flags < 0) throw new RangeError("in the head"); r.extra = count; return show(r); } catch (e: any) { return "caught " + e.constructor.name + " " + (count - before); } }
    function thrower(flags: number): number { count += 10; if (flags & 1) throw new RangeError("thrower"); return flags; }
    function callMayThrow(flags: number): string { const before = count; let r: Ty | undefined; try { r = new T(flags); r.extra = thrower(flags); r.sym = "after"; } catch (e: any) { return "caught " + (count - before) + " " + (r ? show(r) : "nothing"); } return show(r) + " " + (count - before); }
    function nested(flags: number): string { const r = new T(flags); const inner = new T(flags + 1); inner.extra = 1; inner.sym = "inner"; r.other = inner; r.extra = 2; return show(r); }
    function seenFirst(flags: number): string { const r = new T(flags); const keys = Object.keys(r).join(); r.extra = 3; r.sym = keys; return show(r); }
    return { plain, twoObjects, itself, handled, inLoop, conditional, counted, called, callThrows, callMayThrow, nested, seenFirst };
}
function attempt(name: string, f: () => any) { try { const v = f(); log.push(name + ": " + (typeof v === "object" ? show(v) : v)); } catch (e: any) { log.push(name + " threw " + e.constructor.name); } }
function all(label: string) {
    const f = factory();
    attempt(label + " plain", () => f.plain(1, "p")); attempt(label + " twoObjects", () => f.twoObjects(2)); attempt(label + " itself", () => f.itself(3)); attempt(label + " handled", () => f.handled(4, "h"));
    attempt(label + " inLoop", () => f.inLoop(3)); attempt(label + " conditional yes", () => f.conditional(5, true)); attempt(label + " conditional no", () => f.conditional(6, false));
    attempt(label + " counted", () => f.counted(7)); attempt(label + " counted again", () => f.counted(8)); attempt(label + " called", () => f.called(9)); attempt(label + " callThrows", () => f.callThrows(10)); attempt(label + " callThrows throws", () => f.callThrows(-10));
    attempt(label + " callMayThrow even", () => f.callMayThrow(12)); attempt(label + " callMayThrow odd", () => f.callMayThrow(13)); attempt(label + " nested", () => f.nested(14)); attempt(label + " seenFirst", () => f.seenFirst(15));
}
all("predicted");
for (const [name, maker] of [["reordered", Reordered], ["replaces", Replaces], ["frozen", Frozen]] as [string, any][]) { makers.get = () => maker; all(name); }
console.log(log.join("\n"));
export {};
