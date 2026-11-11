// What the body of a module makes out of the text alone and only stores in a variable is made at the first read of the variable.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
(globalThis as any).report = (value: unknown) => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
declare function report(value: unknown): void;
function tell(read: () => unknown) { try { return String(read()); } catch (e: any) { return e.name; } }
function readPattern() { return pattern; }
function readPatternAgain() { return pattern; }
function readTable() { return table; }
function readTableAgain() { return table; }
function readList() { return list; }
function readListAgain() { return list; }
function readArrow() { return arrow; }
function readArrowAgain() { return arrow; }
function readNamed() { return named; }
function readNamedAgain() { return named; }
function readOlder() { return older; }
function readOlderAgain() { return older; }
function readOlderList() { return olderList; }
function readOlderListAgain() { return olderList; }
function kindOfPattern() { return typeof pattern; }
function callArrow(x: number) { return arrow(x); }
function callNamed() { return named(); }
report(tell(readPattern));
report(tell(readTable));
report(tell(readList));
report(tell(readArrow));
report(tell(readNamed));
report(tell(kindOfPattern));
report(tell(() => callArrow(1)));
report(tell(callNamed));
report(tell(readOlder));
report(tell(readOlderList));
report(readOlder() === undefined);
report(readOlder() === null);
report(readOlderList() === undefined);
const pattern = /a+/g;
const table = { a: 1, inner: { b: "x" }, list: [1, 2, 3] };
const list = ["p", "q", "r"];
const arrow = (x: number) => x + 1;
const named = function inner(): unknown { return inner; };
var older = /z+/y;
var olderList = [4, 5, 6];
report(tell(kindOfPattern));
report(readPattern() === readPatternAgain());
report(readPattern().test("xaaa"));
report(readPatternAgain().lastIndex);
report(readTable() === readTableAgain());
readTable().a = 7;
readTable().inner.b = "y";
readTable().list.push(4);
report(JSON.stringify(readTableAgain()));
report(readList() === readListAgain());
readList()[1] = "changed";
report(readListAgain().join());
report(callArrow(4));
report(readArrow() === readArrowAgain());
(readArrow() as any).tag = "kept";
report((readArrowAgain() as any).tag);
report(readNamed() === readNamedAgain());
report(callNamed() === readNamed());
report(readNamed().name + readArrow().name + readArrow().length);
report(readOlder() === readOlderAgain());
report(readOlder().sticky);
report(readOlder() === null);
report(readOlderList() === readOlderListAgain());
readOlderList().length = 1;
report(readOlderListAgain().join());
report(Object.getPrototypeOf(readPattern()) === RegExp.prototype);
report(Object.getPrototypeOf(readTable()) === Object.prototype);
report(Array.isArray(readList()));
Object.freeze(readTable());
report(Object.isFrozen(readTableAgain()));
report("end");
