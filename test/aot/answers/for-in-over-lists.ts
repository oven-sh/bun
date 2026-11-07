// answers: without-library
// # a step of a for-in over what is written to be a list looks at the storage, and the accesses of the turn take the index itself: the key is a text wherever anybody looks at it, a hole is passed by, and whatever is no plain list takes the step as written
// # f1 = walk, f2 = store, f3 = changed, f4 = asked, f10 = tell
// # RUN(FORM): walk f1 f3 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = IsElementInStorage
// # FORM-LABEL: code f3:Body
// # FORM: = IsElementInStorage
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 27 of 27 of 27
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function walk(list: number[]) { let text = ""; for (const i in list) text += typeof i + i + "=" + list[i as any] + ","; return text; }
function store(list: unknown[]) { for (const i in list) list[i as any] = i; let text = ""; for (let at = 0; at < list.length; at++) text += typeof list[at] + list[at] + ","; return text; }
function changed(list: number[], change: (list: number[], i: string) => void) { let text = ""; for (const i in list) { change(list, i); text += i + "=" + list[i as any] + ","; } return text + list.length; }
function asked(list: number[]) { let text = ""; for (const i in list) text += (i in list ? "+" : "-") + (i === "1" ? "one" : i + 1) + ","; return text; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
function holes() { const list = [1, 2, 3, 4]; delete list[1]; return list; }
function above() { const list = [1, 2, 3]; delete list[1]; Object.setPrototypeOf(list, Object.assign(Object.create(Array.prototype), { 1: 20 })); return list; }
function named() { return Object.assign([1, 2], { name: 9 }) as number[]; }
function sparse() { const list: number[] = []; list[3] = 4; list[100000] = 5; return list; }
function getter() { const list = [1, 2, 3]; Object.defineProperty(list, 1, { get() { return 20; }, enumerable: true, configurable: true }); return list; }
tell(() => walk([1, 2, 3]));
tell(() => walk([]));
tell(() => walk([1.5, 2.5]));
tell(() => walk(holes()));
tell(() => walk(above()));
tell(() => walk(named()));
tell(() => walk(sparse()));
tell(() => walk(getter()));
tell(() => walk(Object.freeze([7, 8]) as number[]));
tell(() => walk(JSON.parse("[4,5]")));
tell(() => walk({ 0: 1, 1: 2, x: 3 } as any));
tell(() => walk(new Uint8Array([7, 8]) as any));
tell(() => walk("ab" as any));
tell(() => walk(new Proxy([1, 2], {}) as any));
tell(() => walk(null as any));
tell(() => store([10, 20, 30]));
tell(() => store(["a", , "c"]));
tell(() => changed([1, 2, 3], () => {}));
tell(() => changed([1, 2, 3, 4], (list, i) => { if (i === "1") list.pop(); }));
tell(() => changed([1, 2, 3], (list, i) => { if (i === "0") list.push(9); }));
tell(() => changed([1, 2, 3], (list, i) => { if (i === "0") list.length = 0; }));
tell(() => changed([1, 2, 3], (list, i) => { if (i === "0") delete list[2]; }));
tell(() => changed([1, 2, 3], (list, i) => { if (i === "0") list[100000] = 5; }));
tell(() => changed([1, 2, 3], (list, i) => { if (i === "0") (list as unknown[])[1] = "text"; }));
tell(() => asked([1, 2, 3]));
tell(() => asked(holes()));
report("end");
