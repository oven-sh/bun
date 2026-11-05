// answers: without-library
// # `number[]` declares no kind of storage: the list has what its maker and the numbers so far have given it. A store and a push choose their arm by the kind that they find, and what the kind refuses (a fraction, -0, NaN, 2^31 in storage for int32; NaN in storage for doubles) goes to the stub, which gives the list another kind.
// # f1 = show, f2 = describe, f3 = tell, f4 = fill, f5 = count, f6 = setOne, f7 = gather, f8 = sum
// # In a loop: an arm for each of the three kinds, and the stub of the proven store where none takes the value. No store by key.
// # RUN(FILLINT32): emit f4 mechanisms=all-Inlining
// # FILLINT32-LABEL: unit f4:Body
// # FILLINT32: = Store({{*}}indexedInt32Properties
// # RUN(FILLDOUBLE): emit f4 mechanisms=all-Inlining
// # FILLDOUBLE-LABEL: unit f4:Body
// # FILLDOUBLE: = Store({{*}}indexedDoubleProperties
// # RUN(FILLANY): emit f4 mechanisms=all-Inlining
// # FILLANY-LABEL: unit f4:Body
// # FILLANY: = Store({{*}}indexedContiguousProperties
// # RUN(FILLSTUB): bytes f4:Body mechanisms=all-Inlining
// # FILLSTUB: ArrayPutAtIndex.Number
// # RUN(FILLNOT): bytes f4:Body mechanisms=all-Inlining
// # FILLNOT-NOT: PutByVal
// # Outside of loops: storage for int32 and for doubles.
// # RUN(ONEINT32): emit f6 mechanisms=all-Inlining
// # ONEINT32-LABEL: unit f6:Body
// # ONEINT32: = Store({{*}}indexedInt32Properties
// # RUN(ONEDOUBLE): emit f6 mechanisms=all-Inlining
// # ONEDOUBLE-LABEL: unit f6:Body
// # ONEDOUBLE: = Store({{*}}indexedDoubleProperties
// # RUN(ONENOT): emit f6 mechanisms=all-Inlining
// # ONENOT-LABEL: unit f6:Body
// # ONENOT-NOT: = Store({{*}}indexedContiguousProperties
// # The position and the number come as they are held.
// # RUN(FORMS): walk f4 mechanisms=all-Inlining
// # FORMS-LABEL: code f4:Body
// # FORMS: [[sum]]: {{*}} @Double = Add
// # FORMS: PutArrayElement {{*}}, [[sum]] level=Expected [keyIsIntegral, isInBounds]
// # The push of a number that is held as a double.
// # RUN(PUSHINT32): emit f7 mechanisms=all-Inlining
// # PUSHINT32-LABEL: unit f7:Body
// # PUSHINT32: = Store({{*}}indexedInt32Properties
// # RUN(PUSHDOUBLE): emit f7 mechanisms=all-Inlining
// # PUSHDOUBLE-LABEL: unit f7:Body
// # PUSHDOUBLE: = Store({{*}}indexedDoubleProperties
// # The read has storage for doubles in line.
// # RUN(READ): emit f8 mechanisms=all-Inlining-LoopInvariants
// # READ-LABEL: unit f8:Body
// # READ: = Load({{*}}indexedDoubleProperties
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 175 of 175 of 175
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const one: number = +(globalThis as any).nothingIsHere || 1;
let told = "";
function show(x: unknown): string { return Object.is(x, -0) ? "-0" : typeof x === "string" ? "'" + x + "'" : String(x); }
function describe(list: any): string { let text = list.length + ":"; for (let i = 0; i < list.length && i < 12; i++) text += (i in list ? show(list[i]) : "hole") + ","; return text + told; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
function fill(list: number[], from: number): void { for (let i = 0; i < list.length; i++) list[i] = from + i; }
function count(list: number[], above: number): void { for (let i = 0; i < list.length; i++) list[i] = i + 2147483645; }
function setOne(prepare: (list: any) => void, at: number, x: number): string { const list: number[] = []; prepare(list); const position = at | 0; list[position] = x * 2; const first = describe(list); list[position] = x * 2 + 1; return first + " " + describe(list); }
function gather(list: number[], from: number): void { for (let i = 0; i < 3; i++) list.push(from + i); }
function sum(list: number[]): number { let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; return s; }
function addWhole(list: any): void { for (let i = 0; i < 4; i++) list.push(i + 1); }
function addFractions(list: any): void { for (let i = 0; i < 4; i++) list.push(i + 0.5); }
function addMixed(list: any): void { addWhole(list); list[2] = "two"; }
function whole(): number[] { const list: any = []; addWhole(list); return list; }
function fractions(): number[] { const list: any = []; addFractions(list); return list; }
function mixed(): number[] { const list: any = []; addMixed(list); return list; }
function literal(): number[] { return [1, 2, 3, 4]; }
function after(list: number[], f: (list: number[]) => void): string { f(list); const first = describe(list); f(list); return first + " " + describe(list); }
const makers: (() => number[])[] = [whole, fractions, mixed, literal];
const adders: ((list: any) => void)[] = [addWhole, addFractions, addMixed, list => {}];
function putIntoEach(make: () => number[], add: (list: any) => void): void { tell(() => after(make(), list => fill(list, one))); tell(() => after(make(), list => fill(list, one / 4))); tell(() => after(make(), list => fill(list, -one * 0))); tell(() => after(make(), list => fill(list, one / 0 - one / 0))); tell(() => after(make(), list => fill(list, one * 2147483646))); tell(() => after(make(), list => count(list, one))); tell(() => setOne(add, 0, one)); tell(() => setOne(add, 0, one / 4)); tell(() => setOne(add, 3, -one * 0)); tell(() => setOne(add, 3, one / 0 - one / 0)); tell(() => setOne(add, 3, one * 1073741824)); tell(() => setOne(add, 4, one)); tell(() => setOne(add, 6, one)); tell(() => setOne(add, -1, one)); tell(() => after(make(), list => gather(list, one))); tell(() => after(make(), list => gather(list, one / 4))); tell(() => after(make(), list => gather(list, -one * 0))); tell(() => after(make(), list => gather(list, one / 0 - one / 0))); tell(() => after(make(), list => gather(list, one * 2147483646))); tell(() => sum(make())); tell(() => describe(make())); }
for (let m = 0; m < makers.length; m++) putIntoEach(makers[m], adders[m]);
const changes: ((list: any) => void)[] = [list => { delete list[1]; }, list => { Object.freeze(list); }, list => { Object.seal(list); }, list => { delete list[1]; Object.preventExtensions(list); }, list => { Object.defineProperty(list, "length", { writable: false }); }, list => { Object.defineProperty(list, 1, { get() { return 70; }, set(x: unknown) { told += "|" + show(x); }, enumerable: true, configurable: true }); }, list => { Object.defineProperty(list, 1, { value: 70, writable: false, enumerable: true, configurable: true }); }, list => { delete list[1]; const above = Object.create(Array.prototype); Object.defineProperty(above, 1, { set(x: unknown) { told += "|1:" + show(x); } }); Object.defineProperty(above, 4, { set(x: unknown) { told += "|4:" + show(x); } }); Object.setPrototypeOf(list, above); }, list => { list[70000] = 5; }];
function fresh(f: () => unknown): void { told = ""; tell(f); }
function putIntoChanged(add: (list: any) => void, change: (list: any) => void): void { const prepare = (list: any) => { add(list); change(list); }; const make = (): number[] => { const list: any = []; prepare(list); return list; }; fresh(() => after(make(), list => fill(list, one))); fresh(() => setOne(prepare, 1, one)); fresh(() => setOne(prepare, 4, one / 4)); fresh(() => after(make(), list => gather(list, one))); fresh(() => sum(make())); }
for (let c = 0; c < changes.length; c++) { putIntoChanged(addWhole, changes[c]); putIntoChanged(addFractions, changes[c]); }
report("end");
