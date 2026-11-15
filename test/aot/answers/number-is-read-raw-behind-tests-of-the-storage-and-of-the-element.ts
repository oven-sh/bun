// answers: without-library
// # `list[i]` on a proven list of which `number[]` is written: of what it holds nothing is proven, and the kind of its storage says it: behind HasArrayStorage and IsElementPresent the read is a load that gives a number. A way for storage of int32 and one for storage of doubles meet at once in one number held as a double, and the sum and the store behind it take it so. Storage for any value, a hole, a position outside, an accessor, storage that is far apart: the stretch is walked closed.
// # f1 = show, f2 = describe, f3 = tell, f4 = bump, f5 = halve, f6 = sum, f7 = farOut
// # RUN(LOOP): walk f4 mechanisms=all-Inlining
// # LOOP-LABEL: code f4:Body
// # LOOP: [[isInt32]]: boolean @Boolean = HasArrayStorage [[list]] arrayStorage=Int32
// # LOOP: Branch [[isInt32]]
// # LOOP: ([[number]]: number @Double
// # LOOP: [[more]]: number @Double = Add [[number]]
// # LOOP: PutArrayElement {{*}}, [[more]] level=Expected
// # LOOP: = HasArrayStorage [[list]] arrayStorage=Double
// # LOOP: = IsElementPresent [[list]], [[at]] arrayStorage=Int32 [keyIsIntegral
// # LOOP: i32 @Int32 = GetArrayElement [[list]], [[at]] arrayStorage=Int32 level=Proven [keyIsIntegral, isPresent]
// # LOOP: = IsElementPresent [[list]], [[at]] arrayStorage=Double [keyIsIntegral
// # LOOP: number @Double = GetArrayElement [[list]], [[at]] arrayStorage=Double level=Proven [keyIsIntegral, isPresent]
// # Outside of loops the read and the division are two.
// # RUN(ONCE): walk f5 mechanisms=all-Inlining
// # ONCE-LABEL: code f5:Body
// # ONCE: = IsElementPresent
// # ONCE: number @Double = GetArrayElement {{*}} arrayStorage=Double level=Proven [keyIsIntegral, isPresent]
// # A sum that goes round the loop would be boxed where the arms meet: the guess steps aside.
// # RUN(SUM): walk f6 mechanisms=all-Inlining-LoopInvariants
// # SUM-LABEL: code f6:Body
// # SUM-NOT: = IsElementPresent
// # The test of the element stays in the loop, behind the branch on the kind, though neither the list nor the position changes.
// # RUN(STAYS): walk f7 mechanisms=all-Inlining
// # STAYS-LABEL: code f7:Body
// # STAYS: isLoopHead=true
// # STAYS: = IsElementPresent
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 316 of 316 of 316
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let told = "";
function show(x: unknown): string { return Object.is(x, -0) ? "-0" : typeof x === "string" ? "'" + x + "'" : String(x); }
function describe(list: any): string { let text = list.length + ":"; for (let i = 0; i < list.length && i < 12; i++) text += (i in list ? show(list[i]) : "hole") + ","; return text + told; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
function bump(list: number[]): void { for (let i = 0; i < list.length && i < 9; i++) list[i] = list[i] + 1; }
function halve(prepare: (list: any) => void, at: number): string { const list: number[] = []; prepare(list); const position = at | 0; list[0] = list[position] / 2; return describe(list); }
function sum(list: number[]): number { let s = 0; for (let i = 0; i < list.length && i < 9; i++) s += list[i]; return s; }
function farOut(prepare: (list: any) => void, turns: number): string { const list: number[] = []; prepare(list); for (let k = 0; k < turns; k++) list[0] = list[60000] / 2 + k; return describe(list); }
function addWhole(list: any): void { for (let i = 0; i < 4; i++) list.push(i + 1); }
function addFractions(list: any): void { for (let i = 0; i < 4; i++) list.push(i + 0.5); }
function addMixed(list: any): void { addWhole(list); list[2] = "two"; }
function addObjects(list: any): void { addWhole(list); list[2] = { valueOf() { told += "|asked"; return 40; } }; }
function made(add: (list: any) => void): number[] { const list: any = []; add(list); return list; }
function twice(list: number[], f: (list: number[]) => void): string { f(list); const first = describe(list); f(list); return first + " " + describe(list); }
const adders: ((list: any) => void)[] = [addWhole, addFractions, addMixed, addObjects, list => {}];
const changes: ((list: any) => void)[] = [list => {}, list => { delete list[1]; }, list => { delete list[1]; const above = Object.create(Array.prototype); Object.defineProperty(above, 1, { get() { told += "|above"; return 70; } }); Object.setPrototypeOf(list, above); }, list => { Object.defineProperty(list, 1, { get() { told += "|own"; return 70; }, enumerable: true, configurable: true }); }, list => { Object.freeze(list); }, list => { list[70000] = 5; }, list => { list.length = 2; }];
function fresh(f: () => unknown): void { told = ""; tell(f); }
function readOutOf(add: (list: any) => void, change: (list: any) => void): void { const prepare = (list: any) => { add(list); change(list); }; fresh(() => twice(made(prepare), bump)); fresh(() => halve(prepare, 0)); fresh(() => halve(prepare, 1)); fresh(() => halve(prepare, 2)); fresh(() => halve(prepare, 3)); fresh(() => halve(prepare, 4)); fresh(() => halve(prepare, -1)); fresh(() => farOut(prepare, told.length + 3)); fresh(() => sum(made(prepare))); }
for (let a = 0; a < adders.length; a++) { for (let c = 0; c < changes.length; c++) readOutOf(adders[a], changes[c]); }
report("end");
