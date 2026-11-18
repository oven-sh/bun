// answers: without-library
// # `flags[list[i]]` in a loop, where every getter that Link sees laid on the object is a closure of one function: the read probes the place of the cache by key once: at an own getter's place the accessor's cell comes back and nothing is called there, the code takes the getter out of it, tests its function and calls it itself; whatever else comes back is the answer.
// # Each object is warmed on its own, 400 walks over the list, then it changes under a name out of JSON.parse, which Link does not see:
// # another function in the place of a getter . a value . nothing . another closure of the same function . a setter alone . and the list gets keys that are no texts
// # f1 = getterOf, f8 = build, f2 = readA, f3 = readB, f4 = readC, f5 = readD, f6 = readE, f7 = often, f9 = tell
// # RUN(FORM): bytes f2:Body mechanisms=all-Inlining
// # FORM-LABEL: unit f2:Body
// # FORM: GetByValCachedOrOwnAccessor
// # RUN(WALK): walk f2 mechanisms=all-Inlining
// # WALK-LABEL: code f2:Body
// # WALK: = ElemGetOrOwnAccessor {{*}}
// # WALK-NEXT: = GetGetterOfAccessorOrUndefined {{*}}
// # WALK-NEXT: = TypeTest {{*}}testedType=undefined
// # WALK: = TypeTest {{*}}testedType=f
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 19 of 19 of 19
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const hidden = JSON.parse('{"define":"defineProperty","n5":"n5"}');
const objects: any = Object;
const names: string[] = [];
for (let i = 0; i < 40; i++) names.push("n" + i);
function getterOf(name: string, weight: number, holder: object) { return function (this: unknown) { return name + ":" + weight + ":" + (this === holder ? "own" : "other"); }; }
function build(weight: number): any { const flags: any = Object.create(null); for (let k = 0; k < names.length; k++) { const name = names[k]; Object.defineProperty(flags, name, { get: getterOf(name, weight, flags), enumerable: true, configurable: true }); } return flags; }
const flagsA = build(1);
const flagsB = build(2);
const flagsC = build(3);
const flagsD = build(4);
const flagsE = build(5);
const list: any[] = ["n3", "n17", "n5", "n9", "n39"];
function readA() { let all = ""; for (let i = 0; i < list.length; i++) all += flagsA[list[i]] + " "; return all; }
function readB() { let all = ""; for (let i = 0; i < list.length; i++) all += flagsB[list[i]] + " "; return all; }
function readC() { let all = ""; for (let i = 0; i < list.length; i++) all += flagsC[list[i]] + " "; return all; }
function readD() { let all = ""; for (let i = 0; i < list.length; i++) all += flagsD[list[i]] + " "; return all; }
function readE() { let all = ""; for (let i = 0; i < list.length; i++) all += flagsE[list[i]] + " "; return all; }
function often(read: () => unknown) { let last: unknown; for (let i = 0; i < 400; i++) last = read(); return last; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
tell(() => often(readA));
objects[hidden.define](flagsA, "n3", { get() { return "another function"; }, configurable: true });
tell(() => readA());
tell(() => often(readA));
tell(() => often(readB));
objects[hidden.define](flagsB, "n17", { value: "a value", configurable: true });
tell(() => readB());
tell(() => often(readB));
tell(() => often(readC));
delete flagsC[hidden.n5];
tell(() => readC());
tell(() => often(readC));
tell(() => often(readD));
objects[hidden.define](flagsD, "n9", { get: getterOf("n9", 90, flagsD), configurable: true });
tell(() => readD());
tell(() => often(readD));
tell(() => often(readE));
objects[hidden.define](flagsE, "n39", { get: undefined, set(value: unknown) { report("set"); }, configurable: true });
tell(() => readE());
tell(() => often(readE));
list.push(3, null, 1.5, "n" + list.length);
tell(() => readA());
tell(() => often(readD));
tell(() => often(readE));
report("end");
