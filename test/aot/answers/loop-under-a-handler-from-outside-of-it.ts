// answers: without-library
// # the poll of a loop under a handler from outside leaves that handler where no likely turn may collect. Whatever is thrown in a turn still comes to the handler, with what the turns before it have left
// # f1 = sum, f2 = nested, f3 = throwsAt, f4 = asks, f5 = rare, f6 = inside, f7 = two, f8 = grows
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: LeavesOwedError
// # RUN(KEPT): walk f4 mechanisms=all
// # KEPT-LABEL: code f4:Body
// # KEPT-NOT: LeavesOwedError
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 22 of 22 of 22
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let log = "";
function sum(n: number) { let s = 0; try { for (let i = 0; i < n; i++) s += i; } catch (e) { return "caught"; } return s; }
function nested(n: number) { let s = 0; try { for (let i = 0; i < n; i++) { for (let j = 0; j < i; j++) s += j; } } catch (e) { return "caught"; } return s; }
function throwsAt(n: number, at: number) { let s = 0; try { for (let i = 0; i < n; i++) { if (i === at) throw new RangeError("at" + i); s += i; } } catch (e) { return (e as Error).message + s; } return s; }
function asks(n: number, o: any) { let s = 0; try { for (let i = 0; i < n; i++) s += o.step; } catch (e) { return (e as Error).name + s; } return s; }
function rare(n: number, o: any) { let s = 0; try { for (let i = 0; i < n; i++) { if (i === 5) s += o.step; s += i; } } catch (e) { return (e as Error).name + s; } return s; }
function inside(n: number, o: any) { let s = 0; for (let i = 0; i < n; i++) { try { s += o.step; } catch (e) { s += 100; } } return s; }
function two(n: number) { let s = 0; try { for (let i = 0; i < n; i++) s += i; for (let i = 0; i < n; i++) s += 2 * i; } catch (e) { return "caught"; } finally { log += "finally;"; } return s; }
function grows(n: number) { const made: { i: number }[] = []; try { for (let i = 0; i < n; i++) made[i] = { i }; } catch (e) { return "caught"; } return made.length; }
report(sum(0));
report(sum(1));
report(sum(1000));
report(nested(0));
report(nested(30));
report(throwsAt(9, 4));
report(throwsAt(9, 0));
report(throwsAt(3, 7));
report(asks(3, { step: 2 }));
report(asks(3, { get step() { log += "read;"; return 1; } }));
report(asks(3, { get step(): number { throw new RangeError("step"); } }));
report(asks(3, null));
report(asks(0, null));
report(rare(9, { step: 1000 }));
report(rare(9, null));
report(rare(3, null));
report(inside(3, { step: 2 }));
report(inside(3, null));
report(two(4));
report(grows(2000));
report(log);
report("end");
