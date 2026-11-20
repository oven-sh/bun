// answers: without-library
// # accesses under a variable that holds a written text, under a key joined of two parts, and under any text on a fresh record: on plain objects, accessors, frozen objects, primitives, undefined, and a key that converts with a side effect
// # f1 = read, f7 = handlerOf, f8 = pick, f9 = tell
// # RUN(FORM): walk f1 mechanisms=all-Guesses-ParameterGuards
// # FORM-LABEL: code f1:Body
// # FORM: = PropGet {{*}}key="kind"
// # RUN(PARTS): walk f7 mechanisms=all
// # PARTS-LABEL: code f7:
// # PARTS: = ElemGetByKeyParts
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 30 of 30 of 30
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let log = "";
let last = "start";
class Plain { kind: string; constructor(kind: string) { this.kind = kind; } }
class Lazy { get kind() { log += "g"; return "lazy"; } set kind(v: string) { log += "s"; } }
function read(o: any) { const k = "kind"; return o[k]; }
function store(o: any, v: string) { const k = "kind"; o[k] = v; return o.kind; }
function has(o: any) { const k = "kind"; return k in o; }
function remove(o: any) { const k = "kind"; return delete o[k]; }
function underUndefined(o: any) { return o[undefined as any]; }
function underIndex(o: any) { const k = "1"; return o[k]; }
function handlerOf(handlers: any, type: string) { return handlers["on" + type]; }
function pick(name: string) { const table: any = { a: 1, b: 2 }; last = "before"; const found = table[name]; return found + ":" + last; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
const handlers = { onopen: "open", get onclose() { log += "c"; return "close"; } };
const converts = { toString() { last = "converted"; return "b"; } };
tell(() => read(new Plain("p")));
tell(() => read(new Lazy()));
tell(() => read({ other: 1 }));
tell(() => read("text"));
tell(() => read(undefined));
tell(() => store(new Plain("p"), "q"));
tell(() => store(new Lazy(), "q"));
tell(() => store(Object.freeze({ kind: "frozen" }), "q"));
tell(() => has(new Plain("p")));
tell(() => has(new Lazy()));
tell(() => has({}));
tell(() => has(5));
tell(() => remove(new Plain("p")));
tell(() => remove(Object.freeze({ kind: "frozen" })));
tell(() => underUndefined({ undefined: "u" }));
tell(() => underIndex(["zero", "one"]));
tell(() => underIndex({ 1: "named one" }));
tell(() => handlerOf(handlers, "open"));
tell(() => handlerOf(handlers, "close"));
tell(() => handlerOf(handlers, "error"));
tell(() => handlerOf(null, "open"));
tell(() => pick("a"));
tell(() => pick("c"));
tell(() => pick("__proto__") === "[object Object]:before");
tell(() => pick(converts as any));
tell(() => read(new Plain("again")));
tell(() => handlerOf(handlers, "open"));
tell(() => pick("b"));
report(log);
report("end");
