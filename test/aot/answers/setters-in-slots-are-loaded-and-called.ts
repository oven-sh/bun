// answers: without-library
// # whichever setter lies in the slot is called with the object as `this` and what is stored as its argument. An accessor without a setter throws in strict code, a frozen object still runs its setter, and an heir runs it for itself
// # f1 = put
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = GetSlotSetter
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 12 of 12 of 12
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
type Box = { seen: number; value: number };
function put(box: Box, v: number) { box.value = v; return box.seen; }
function make(): Box { return { seen: 0, set value(v: number) { this.seen = v * 2; } } as Box; }
function onlyGetter(): Box { return { seen: 0, get value() { return 1; } } as Box; }
function throwing(): Box { return { seen: 0, set value(v: number) { throw new SyntaxError("no store"); } } as Box; }
function parsed(text: string): any { return JSON.parse(text); }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
tell(() => put(make(), 1));
tell(() => put(make(), 2));
tell(() => put(onlyGetter(), 3));
tell(() => put(throwing(), 4));
tell(() => put(parsed("{\"seen\":5}"), 6));
tell(() => { const heir = Object.create(make()); return String(put(heir, 7)) + String(Object.keys(heir).length); });
tell(() => put(Object.freeze(make()), 8));
tell(() => put(new Proxy(make(), {}), 9));
tell(() => put(null as any, 1));
tell(() => put(7 as any, 1));
tell(() => { let s = 0; for (let i = 0; i < 300; i++) s += put(make(), i); return s; });
report("end");
