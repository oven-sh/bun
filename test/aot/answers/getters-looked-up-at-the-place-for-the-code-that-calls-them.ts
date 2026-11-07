// answers: without-library
// # `flags.n3`, where Link expects one getter and the code calls it itself: the lookup in front of the call asks the place. Each place is warmed on its own, 400 reads, then its object changes under a name out of JSON.parse
// # another function in the place of the getter . a value . nothing . another closure of the same function . another Structure with the same getter
// # f1 = getterOf, f8 = build, f2 = readA, f3 = readB, f4 = readC, f5 = readD, f6 = readE, f7 = often, f9 = tell
// # RUN(FORM): bytes f2:Body mechanisms=all-Inlining
// # FORM-LABEL: unit f2:Body
// # FORM: GetterAtSite.UnderNameWithColumn
// # RUN(WALK): walk f2 mechanisms=all-Inlining
// # WALK-LABEL: code f2:Body
// # WALK: = GetCachedGetter {{*}}key="n3"
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 17 of 17 of 17
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const hidden = JSON.parse('{"define":"defineProperty","below":"setPrototypeOf","n5":"n5"}');
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
function readA() { return flagsA.n3; }
function readB() { return flagsB.n17; }
function readC() { return flagsC.n5; }
function readD() { return flagsD.n9; }
function readE() { return flagsE.n39; }
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
objects[hidden.below](flagsE, { more: 1 });
tell(() => readE());
flagsE.added = 1;
tell(() => readE());
tell(() => often(readE));
report("end");
