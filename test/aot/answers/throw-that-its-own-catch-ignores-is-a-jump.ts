// answers: without-library
// # a throw under a catch that reads nothing of what it catches is a jump, and an error that nobody reads is never made. What is seen of the making still happens: a message that converts itself, a constructor of the program, a call, a finally between
// # f7 = plain, f8 = made, f1 = converts, f9 = own, f2 = called, f10 = reads, f11 = between, f3 = inLoop, f4 = stored, f5 = both, f12 = again, f13 = goesOn, f14 = after, f6 = tell, f15 = each
// # RUN(FORM): walk f7 f8 mechanisms=none+DirectCalls+BuiltinCalls+Handlers
// # FORM-NOT: Throw v
// # RUN(WRITTEN): walk f7 f8 mechanisms=none+DirectCalls+BuiltinCalls
// # WRITTEN-LABEL: code f7:Body
// # WRITTEN: Throw v
// # WRITTEN-LABEL: code f8:Body
// # WRITTEN: Throw v
// # RUN(KEPT): walk f10 mechanisms=none+DirectCalls+BuiltinCalls+Handlers
// # KEPT-LABEL: code f10:Body
// # KEPT: Throw v
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 139 of 139 of 139
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let log = "";
class MyError extends Error { constructor(message: string) { super(message); log += "made;"; } }
const printing = { toString() { log += "printed;"; return "text"; } };
const refusing = { toString(): string { log += "refused;"; throw new RangeError("no text"); } };
function plain(bad: unknown) { try { if (bad) throw "bad"; return "fine"; } catch { return "caught"; } }
function made(bad: unknown) { try { if (bad) throw new Error("bad"); return "fine"; } catch { return "caught"; } }
function converts(bad: unknown, message: unknown) { try { if (bad) throw new Error(message as string); return "fine"; } catch { return "caught"; } }
function own(bad: unknown) { try { if (bad) throw new MyError("bad"); return "fine"; } catch { return "caught"; } }
function called(bad: unknown, make: () => unknown) { try { if (bad) throw make(); return "fine"; } catch { return "caught"; } }
function reads(bad: unknown) { try { if (bad) throw new Error("bad"); return "fine"; } catch (e) { return (e as Error).message; } }
function between(bad: unknown) { try { try { if (bad) throw new Error("bad"); return "fine"; } finally { log += "finally;"; } } catch { return "caught"; } }
function inLoop(n: number) { let i = 0; try { for (; i < n; i++) { if (i === 3) throw new Error("three"); } } catch { return "caught" + i; } return "done" + i; }
function stored(stop: number) { let at = "start"; try { at = "one"; if (stop === 1) throw new Error("1"); at = "two"; if (stop === 2) throw new Error("2"); at = "three"; } catch { return "caught " + at; } return "done " + at; }
function both(o: any) { try { if (o.bad) throw new Error("bad"); return o.value.deep; } catch { return "caught"; } }
function again(bad: unknown) { try { try { if (bad) throw new Error("inner"); } catch { throw new Error("outer"); } return "fine"; } catch (e) { return (e as Error).message; } }
function goesOn(bad: unknown) { let text = "a"; try { text += "b"; if (bad) throw new Error("bad"); text += "c"; } catch { text += "d"; } return text + "e"; }
function after(bad: unknown) { let kept: Error | undefined; try { if (bad) { kept = new Error("kept"); throw kept; } } catch { } return kept ? kept.message : "none"; }
function tell(f: () => unknown) { log = ""; try { report(f()); } catch (e) { report((e as Error).name + (e as Error).message); } report(log); }
function each(f: (bad: unknown) => unknown) { tell(() => f(false)); tell(() => f(true)); tell(() => f(0)); tell(() => f("x")); }
each(plain);
each(made);
each(bad => converts(bad, "text"));
each(bad => converts(bad, printing));
each(bad => converts(bad, refusing));
each(bad => converts(bad, Symbol("no text")));
each(bad => converts(bad, undefined));
each(own);
each(bad => called(bad, () => { log += "called;"; return 1; }));
each(bad => called(bad, () => { log += "threw;"; throw new RangeError("inside"); }));
each(reads);
each(between);
tell(() => inLoop(2));
tell(() => inLoop(9));
tell(() => stored(0));
tell(() => stored(1));
tell(() => stored(2));
tell(() => both({ bad: true }));
tell(() => both({ bad: false, value: { deep: "deep" } }));
tell(() => both({ bad: false }));
tell(() => both(null));
each(again);
each(goesOn);
each(after);
report("end");
