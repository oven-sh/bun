// answers: without-library
// # nobody knows the receiver, so the place of the read remembers where the GetterSetter lies: in the cell or the storage of the receiver, in the cell or the storage of a holder above it. Each place is warmed on its own, 400 reads, then something changes
// # every object comes out of a list that JSON.parse made, and every deed goes by a name out of JSON.parse
// # f1 = through, f2 = readClass, f3 = readAbove, f4 = readNear, f5 = readOwnFew, f6 = readOwnMany, f7 = readTwo, f8 = readMixed, f9 = readThrows, f10 = warm, f11 = lay, f12 = layMany, f13 = inTurns, f14 = tell
// # RUN(FORM): bytes f2:Body mechanisms=all
// # FORM-LABEL: unit f2:Body
// # FORM: Call Stub ReadAtSite
// # RUN(ABOVE): bytes f3:Body mechanisms=all
// # ABOVE-LABEL: unit f3:Body
// # ABOVE: Call Stub ReadAtSite
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 31 of 31 of 31
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const slot = JSON.parse("[0]");
const hidden = JSON.parse('{"define":"defineProperty","below":"setPrototypeOf","create":"create","p30":"p30","n17":"n17"}');
const objects: any = Object;
let fails = false;
class P1 { n = 1; get size() { return this.n + 1; } }
class P7 { n = 7; get size() { return this.n; } }
class P8 { get size() { if (fails) throw new RangeError("thrown"); return 8; } }
function through(value: unknown): any { slot[0] = value; return slot[0]; }
function readClass(o: any) { return o.size; }
function readAbove(o: any) { return o.p30; }
function readNear(o: any) { return o.near; }
function readOwnFew(o: any) { return o.own; }
function readOwnMany(o: any) { return o.n17; }
function readTwo(o: any) { return o.n5; }
function readMixed(o: any) { return o.size; }
function readThrows(o: any) { return o.size; }
function warm(read: (o: any) => unknown, o: any) { let last: unknown; for (let i = 0; i < 400; i++) last = read(o); return last; }
function lay(o: any, name: string, value: number) { objects[hidden.define](o, name, { get() { return value + (this === o ? 0 : 100); }, configurable: true, enumerable: true }); }
function layMany(prefix: string, base: number) { const o = objects[hidden.create](null); for (let i = 0; i < 40; i++) lay(o, prefix + i, base + i); return o; }
function inTurns(one: any, other: any) { let both = ""; for (let i = 0; i < 600; i++) both = readTwo(i & 1 ? one : other) + " " + readTwo(i & 1 ? other : one); return both; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
const o1 = through(new P1());
tell(() => warm(readClass, o1));
objects[hidden.define](P1.prototype, "size", { get() { return 20; }, configurable: true });
tell(() => readClass(o1));
tell(() => warm(readClass, o1));
objects[hidden.define](o1, "size", { value: 21, configurable: true });
tell(() => readClass(o1));
tell(() => readClass(through(new P1())));
const many = layMany("p", 0);
const child = objects[hidden.create](many);
tell(() => warm(readAbove, child));
objects[hidden.define](many, "p30", { get() { return "again"; }, configurable: true });
tell(() => readAbove(child));
tell(() => warm(readAbove, child));
delete many[hidden.p30];
tell(() => readAbove(child));
tell(() => warm(readAbove, child));
const few = objects[hidden.create](null);
lay(few, "near", 1);
const kid = objects[hidden.create](few);
tell(() => warm(readNear, kid));
objects[hidden.below](kid, { near: "moved" });
tell(() => readNear(kid));
tell(() => readNear(objects[hidden.create](few)));
const own = objects[hidden.create](null);
lay(own, "own", 5);
tell(() => warm(readOwnFew, own));
objects[hidden.define](own, "own", { value: 6 });
tell(() => readOwnFew(own));
tell(() => warm(readOwnFew, own));
const big = layMany("n", 0);
tell(() => warm(readOwnMany, big));
objects[hidden.define](big, "n17", { get() { return "other"; }, configurable: true });
tell(() => readOwnMany(big));
tell(() => warm(readOwnMany, big));
delete big[hidden.n17];
tell(() => readOwnMany(big));
tell(() => inTurns(layMany("n", 1000), layMany("n", 2000)));
const o7 = through(new P7());
tell(() => warm(readMixed, o7));
tell(() => readMixed(through({ size: "plain" })));
tell(() => readMixed(5));
tell(() => readMixed("text"));
tell(() => readMixed(null));
tell(() => readMixed(o7));
const o8 = through(new P8());
tell(() => warm(readThrows, o8));
fails = true;
tell(() => readThrows(o8));
fails = false;
tell(() => readThrows(o8));
report("end");
