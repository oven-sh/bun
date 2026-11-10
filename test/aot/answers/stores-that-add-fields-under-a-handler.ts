// answers: without-library
// # stores that may add a field under a handler have a poll behind them. The poll changes no answer: each field is there behind its store, and a store that is refused comes to the handler from the place where it stands
// # f1 = show, f2 = fill, f3 = fillSome, f4 = fillInLoop, f5 = fillHostile
// # RUN(FORM): walk f2 mechanisms=all
// # FORM-LABEL: code f2:Body
// # FORM: PutSlotOrAdd
// # FORM: = LoopHint [throwsOwedError]
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 13 of 13 of 13
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
class P { declare x?: unknown; declare y?: unknown; declare z?: unknown; constructor(v: unknown) { if (typeof v === "number") { this.x = v; this.y = v; this.z = v; } } }
class Q { declare x?: unknown; declare y?: unknown; declare z?: unknown; constructor(v: unknown) { if (typeof v === "number") { this.x = v; this.y = v; this.z = v; } } }
function show(o: any) { return String(o.x) + String(o.y) + String(o.z) + ("x" in o) + ("y" in o) + ("z" in o); }
function fill(p: P, v: unknown) { try { p.x = v; p.y = v; p.z = v; return show(p); } catch (e) { return "caught"; } }
function fillSome(p: P, v: unknown, some: boolean) { try { p.x = v; if (some) p.y = v; p.z = v; } catch (e) { return "caught"; } return show(p); }
function fillInLoop(list: P[], v: unknown) { let text = ""; try { for (let i = 0; i < list.length; i++) { list[i].x = v; list[i].z = i; text += show(list[i]); } } catch (e) { return "caught"; } return text; }
function fillHostile(q: Q, v: unknown) { let at = 0; try { q.x = v; at = 1; q.y = v; at = 2; q.z = v; at = 3; } catch (e) { return (e as Error).name + at + show(q); } return at + show(q); }
report(fill(new P("a"), "b"));
report(fill(new P(1), "b"));
report(fill(new P("a"), undefined));
report(fillSome(new P("a"), 2, true));
report(fillSome(new P("a"), 2, false));
report(fillInLoop([new P("a"), new P(1), new P("c")], "v"));
report(fillInLoop([], "v"));
report(fillHostile(new Q("a"), "b"));
report(fillHostile(Object.freeze(new Q("a")), "b"));
report(fillHostile(Object.preventExtensions(new Q("a")), "b"));
report(fillHostile(Object.defineProperty(new Q("a"), "y", { set(v) { throw new RangeError("setter"); } }), "b"));
report(fillHostile(Object.defineProperty(new Q(1), "z", { value: 9, writable: false }), "b"));
report("end");
