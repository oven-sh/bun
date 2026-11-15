// answers: without-library
// # `{ a, ...(given ?? { b }) }` and `{ a, ...(given || { b }) }`: the value on the left is spread where it decides, whatever it is, and the members of the literal are defined where it does not. Everything is evaluated once, in the order written
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 86 of 86 of 86
// # CHECK-NEXT: exited with 0
function nullish(a: number, given: any) { return { a, ...(given ?? { b: 2 }) }; }
function falsy(a: number, given: any) { return { a, ...(given || { b: 2 }) }; }
function empty(a: number, given: any) { return { a, ...(given ?? {}), z: 9 }; }
function nested(a: number, first: any, second: any) { return { a, ...(first ?? second ?? { b: 2 }) }; }
function ordered(log: string[], given: any) { return { a: note(log, "a"), ...(note(log, given) ?? { b: note(log, "b") }), c: note(log, "c") }; }
function note(log: string[], v: any) { log[0] += typeof v === "string" ? v : "?"; return v; }
function show(o: any) { let s = ""; for (const k in o) s += k + "=" + String(o[k]) + ";"; return s; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
function all(given: any) { tell(() => show(nullish(1, given))); tell(() => show(falsy(1, given))); tell(() => show(empty(1, given))); tell(() => show(nested(1, given, undefined))); tell(() => show(nested(1, undefined, given))); tell(() => { const log = [""]; return show(ordered(log, given)) + log[0]; }); }
all(undefined);
all(null);
all(0);
all("");
all(false);
all(NaN);
all("xy");
all(5);
all({ b: 9, q: 1 });
all({ a: "over" });
all({});
all([7]);
all(new Proxy({ b: 3 }, {}));
all({ get b() { return "got"; } });
tell(() => { let s = 0; for (let i = 0; i < 300; i++) s += nullish(i, i % 2 ? undefined : { b: i }).b; return s; });
report("end");
declare function report(value: unknown): void;
