// answers: with-library
// # `hasOwnProperty.call(x, "from")` and `Object.hasOwn(x, "from")` where nothing is proven of x: the name is written, so the question goes by name: no cell is made of the written text and one stub is entered, not two. The stub and its operation take whatever value: what is no object is converted as the function converts it, undefined and null are refused with its error, a proxy's trap runs.
// # f1 = asksFor, f2 = isSpan, f3 = hasLength, f4 = byHasOwn, f5 = tell
// # RUN(BYNAME): walk f2 f3 f4 mechanisms=all
// # BYNAME-LABEL: code f2:Body
// # BYNAME-COUNT-2: = PropHasOwn
// # BYNAME-LABEL: code f3:Body
// # BYNAME-COUNT-1: = PropHasOwn
// # BYNAME-LABEL: code f4:Body
// # BYNAME-COUNT-1: = PropHasOwn
// # RUN(NOCELL): walk f2 f3 f4 mechanisms=all
// # NOCELL-NOT: inlineBuiltin=ObjectHasOwn
// # NOCELL-NOT: = String string=
// # RUN(BYVALUE): walk f1 mechanisms=all
// # BYVALUE: inlineBuiltin=ObjectHasOwn
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 33 of 33 of 33
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=none $SHELL
// # ALSO1: 33 of 33 of 33
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
let log = "";
const has = Object.prototype.hasOwnProperty;
function asksFor(map: any, key: string) { return has.call(map, key); }
function isSpan(list: any) { return asksFor(list, "from") && asksFor(list, "to"); }
function hasLength(value: any) { return has.call(value, "length"); }
function byHasOwn(value: any) { return Object.hasOwn(value, "from"); }
function tell(run: () => unknown) { try { report(run() as boolean); } catch (error) { report(error instanceof TypeError ? "TypeError" : String(error)); } }
const span: any = [1, 2, 3];
span.from = 0;
tell(() => isSpan(span));
span.to = 3;
tell(() => isSpan(span));
tell(() => isSpan([1, 2, 3]));
tell(() => isSpan({ from: 1, to: 2 }));
tell(() => isSpan({ from: undefined, to: undefined }));
tell(() => isSpan({ to: 2 }));
tell(() => isSpan(Object.create({ from: 1, to: 2 })));
tell(() => isSpan(Object.create(null)));
tell(() => isSpan(Object.freeze({ from: 1, to: 2 })));
tell(() => isSpan({ get from() { log += "<got>"; return 1; }, to: 2 }));
tell(() => isSpan(function from() {}));
tell(() => isSpan("from"));
tell(() => isSpan(7));
tell(() => isSpan(true));
tell(() => isSpan(7n));
tell(() => isSpan(Symbol("from")));
tell(() => isSpan(undefined));
tell(() => isSpan(null));
tell(() => isSpan(new Proxy({}, { getOwnPropertyDescriptor(target, key) { log += "<" + String(key) + ">"; return key === "from" ? { value: 1, configurable: true } : undefined; } })));
report(log);
tell(() => hasLength("text"));
tell(() => hasLength([]));
tell(() => hasLength({}));
tell(() => hasLength(function () {}));
tell(() => hasLength(7));
tell(() => hasLength(undefined));
tell(() => byHasOwn(span));
tell(() => byHasOwn("from"));
tell(() => byHasOwn(null));
const removed: any = { from: 1, to: 2 };
tell(() => isSpan(removed));
delete removed.from;
tell(() => isSpan(removed));
removed.from = 2;
tell(() => isSpan(removed));
report("end");
