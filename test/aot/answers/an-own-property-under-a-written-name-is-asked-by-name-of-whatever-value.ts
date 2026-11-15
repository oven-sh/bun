// answers: with-library
// # `hasOwnProperty.call(x, "pos")` and `Object.hasOwn(x, "pos")` where nothing is proven of x: the name is written, so the question goes by name: no cell is made of the written text and one stub is entered, not two. The stub and its operation take whatever value: what is no object is converted as the function converts it, undefined and null are refused with its error, a proxy's trap runs.
// # f1 = hasProperty, f2 = isRanged, f3 = hasLength, f4 = byHasOwn, f5 = tell
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
function hasProperty(map: any, key: string) { return has.call(map, key); }
function isRanged(list: any) { return hasProperty(list, "pos") && hasProperty(list, "end"); }
function hasLength(value: any) { return has.call(value, "length"); }
function byHasOwn(value: any) { return Object.hasOwn(value, "pos"); }
function tell(run: () => unknown) { try { report(run() as boolean); } catch (error) { report(error instanceof TypeError ? "TypeError" : String(error)); } }
const ranged: any = [1, 2, 3];
ranged.pos = 0;
tell(() => isRanged(ranged));
ranged.end = 3;
tell(() => isRanged(ranged));
tell(() => isRanged([1, 2, 3]));
tell(() => isRanged({ pos: 1, end: 2 }));
tell(() => isRanged({ pos: undefined, end: undefined }));
tell(() => isRanged({ end: 2 }));
tell(() => isRanged(Object.create({ pos: 1, end: 2 })));
tell(() => isRanged(Object.create(null)));
tell(() => isRanged(Object.freeze({ pos: 1, end: 2 })));
tell(() => isRanged({ get pos() { log += "<got>"; return 1; }, end: 2 }));
tell(() => isRanged(function pos() {}));
tell(() => isRanged("pos"));
tell(() => isRanged(7));
tell(() => isRanged(true));
tell(() => isRanged(7n));
tell(() => isRanged(Symbol("pos")));
tell(() => isRanged(undefined));
tell(() => isRanged(null));
tell(() => isRanged(new Proxy({}, { getOwnPropertyDescriptor(target, key) { log += "<" + String(key) + ">"; return key === "pos" ? { value: 1, configurable: true } : undefined; } })));
report(log);
tell(() => hasLength("text"));
tell(() => hasLength([]));
tell(() => hasLength({}));
tell(() => hasLength(function () {}));
tell(() => hasLength(7));
tell(() => hasLength(undefined));
tell(() => byHasOwn(ranged));
tell(() => byHasOwn("pos"));
tell(() => byHasOwn(null));
const removed: any = { pos: 1, end: 2 };
tell(() => isRanged(removed));
delete removed.pos;
tell(() => isRanged(removed));
removed.pos = 2;
tell(() => isRanged(removed));
report("end");
