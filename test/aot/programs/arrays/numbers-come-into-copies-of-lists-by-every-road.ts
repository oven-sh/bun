// The numbers in a copy of a list are those of the lists that it copies and of the arguments: every road by which another number comes into the source, the arguments or the copy.
const kept: number[][] = [];
function storeInto(list: number[], value: number): void { list[0] = value; }
function show(x: number): string { return Object.is(x, -0) ? '-0' : String(x); }
const list1: number[] = [1, 2, 3, 4];
function read1(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain1(): number[] { return list1.slice().concat(list1.toSorted()); }
function attack1(): number[] { return Array.prototype.concat.apply(list1, [4294967296]) as number[]; }
for (let turn = 0; turn < 3; turn++) read1(plain1());
try { const c = attack1(); console.log('whole 4294967296 concatApply', read1(c), JSON.stringify(c), read1(list1), read1(plain1())); } catch (e) { console.log('whole 4294967296 concatApply threw', (e as Error).constructor.name); }
const list2: number[] = [1, 2, 3, 4];
function read2(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain2(): number[] { return list2.slice().concat(list2.toSorted()); }
function attack2(): number[] { return Array.prototype.concat.call(list2, 4294967296) as number[]; }
for (let turn = 0; turn < 3; turn++) read2(plain2());
try { const c = attack2(); console.log('whole 4294967296 concatCall', read2(c), JSON.stringify(c), read2(list2), read2(plain2())); } catch (e) { console.log('whole 4294967296 concatCall threw', (e as Error).constructor.name); }
const list3: number[] = [1, 2, 3, 4];
function read3(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain3(): number[] { return list3.slice().concat(list3.toSorted()); }
function attack3(): number[] { const more = [4294967296]; return list3.concat(...more); }
for (let turn = 0; turn < 3; turn++) read3(plain3());
try { const c = attack3(); console.log('whole 4294967296 concatSpreadCall', read3(c), JSON.stringify(c), read3(list3), read3(plain3())); } catch (e) { console.log('whole 4294967296 concatSpreadCall threw', (e as Error).constructor.name); }
const list4: number[] = [1, 2, 3, 4];
function read4(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain4(): number[] { return list4.slice().concat(list4.toSorted()); }
function attack4(): number[] { return (list4.concat.bind(list4, 4294967296) as () => number[])(); }
for (let turn = 0; turn < 3; turn++) read4(plain4());
try { const c = attack4(); console.log('whole 4294967296 concatBound', read4(c), JSON.stringify(c), read4(list4), read4(plain4())); } catch (e) { console.log('whole 4294967296 concatBound threw', (e as Error).constructor.name); }
const list5: number[] = [1, 2, 3, 4];
function read5(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain5(): number[] { return list5.slice().concat(list5.toSorted()); }
function attack5(): number[] { return Reflect.apply(Array.prototype.concat, list5, [4294967296]) as number[]; }
for (let turn = 0; turn < 3; turn++) read5(plain5());
try { const c = attack5(); console.log('whole 4294967296 concatReflect', read5(c), JSON.stringify(c), read5(list5), read5(plain5())); } catch (e) { console.log('whole 4294967296 concatReflect threw', (e as Error).constructor.name); }
const list6: number[] = [1, 2, 3, 4];
function read6(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain6(): number[] { return list6.slice().concat(list6.toSorted()); }
function attack6(): number[] { return (Array.prototype.with as Function).apply(list6, [0, 4294967296]) as number[]; }
for (let turn = 0; turn < 3; turn++) read6(plain6());
try { const c = attack6(); console.log('whole 4294967296 withApply', read6(c), JSON.stringify(c), read6(list6), read6(plain6())); } catch (e) { console.log('whole 4294967296 withApply threw', (e as Error).constructor.name); }
const list7: number[] = [1, 2, 3, 4];
function read7(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain7(): number[] { return list7.slice().concat(list7.toSorted()); }
function attack7(): number[] { return (Array.prototype.with as Function).call(list7, 0, 4294967296) as number[]; }
for (let turn = 0; turn < 3; turn++) read7(plain7());
try { const c = attack7(); console.log('whole 4294967296 withCall', read7(c), JSON.stringify(c), read7(list7), read7(plain7())); } catch (e) { console.log('whole 4294967296 withCall threw', (e as Error).constructor.name); }
const list8: number[] = [1, 2, 3, 4];
function read8(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain8(): number[] { return list8.slice().concat(list8.toSorted()); }
function attack8(): number[] { return Reflect.apply(Array.prototype.with, list8, [0, 4294967296]) as number[]; }
for (let turn = 0; turn < 3; turn++) read8(plain8());
try { const c = attack8(); console.log('whole 4294967296 withReflect', read8(c), JSON.stringify(c), read8(list8), read8(plain8())); } catch (e) { console.log('whole 4294967296 withReflect threw', (e as Error).constructor.name); }
const list9: number[] = [1, 2, 3, 4];
function read9(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain9(): number[] { return list9.slice().concat(list9.toSorted()); }
function attack9(): number[] { return (Array.prototype.toSpliced as Function).apply(list9, [0, 1, 4294967296]) as number[]; }
for (let turn = 0; turn < 3; turn++) read9(plain9());
try { const c = attack9(); console.log('whole 4294967296 toSplicedApply', read9(c), JSON.stringify(c), read9(list9), read9(plain9())); } catch (e) { console.log('whole 4294967296 toSplicedApply threw', (e as Error).constructor.name); }
const list10: number[] = [1, 2, 3, 4];
function read10(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain10(): number[] { return list10.slice().concat(list10.toSorted()); }
function attack10(): number[] { const more = [4294967296, 4294967296]; return list10.toSpliced(0, 1, ...more); }
for (let turn = 0; turn < 3; turn++) read10(plain10());
try { const c = attack10(); console.log('whole 4294967296 toSplicedSpread', read10(c), JSON.stringify(c), read10(list10), read10(plain10())); } catch (e) { console.log('whole 4294967296 toSplicedSpread threw', (e as Error).constructor.name); }
const list11: number[] = [1, 2, 3, 4];
function read11(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain11(): number[] { return list11.slice().concat(list11.toSorted()); }
function attack11(): number[] { const method = list11.with; return method.call(list11, 1, 4294967296); }
for (let turn = 0; turn < 3; turn++) read11(plain11());
try { const c = attack11(); console.log('whole 4294967296 withThroughAVariable', read11(c), JSON.stringify(c), read11(list11), read11(plain11())); } catch (e) { console.log('whole 4294967296 withThroughAVariable threw', (e as Error).constructor.name); }
const list12: number[] = [1, 2, 3, 4];
function read12(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain12(): number[] { return list12.slice().concat(list12.toSorted()); }
function attack12(): number[] { const any: any = list12; return any.concat(4294967296); }
for (let turn = 0; turn < 3; turn++) read12(plain12());
try { const c = attack12(); console.log('whole 4294967296 concatThroughAny', read12(c), JSON.stringify(c), read12(list12), read12(plain12())); } catch (e) { console.log('whole 4294967296 concatThroughAny threw', (e as Error).constructor.name); }
const list13: number[] = [1, 2, 3, 4];
function read13(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain13(): number[] { return list13.slice().concat(list13.toSorted()); }
function attack13(): number[] { const name = 'con' + 'cat'; return (list13 as any)[name](4294967296); }
for (let turn = 0; turn < 3; turn++) read13(plain13());
try { const c = attack13(); console.log('whole 4294967296 concatByName', read13(c), JSON.stringify(c), read13(list13), read13(plain13())); } catch (e) { console.log('whole 4294967296 concatByName threw', (e as Error).constructor.name); }
const list14: number[] = [1, 2, 3, 4];
function read14(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain14(): number[] { return list14.slice().concat(list14.toSorted()); }
function attack14(): number[] { return list14.concat({ length: 1, 0: 4294967296, [Symbol.isConcatSpreadable]: true } as any); }
for (let turn = 0; turn < 3; turn++) read14(plain14());
try { const c = attack14(); console.log('whole 4294967296 concatSpreadable', read14(c), JSON.stringify(c), read14(list14), read14(plain14())); } catch (e) { console.log('whole 4294967296 concatSpreadable threw', (e as Error).constructor.name); }
const list15: number[] = [1, 2, 3, 4];
function read15(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain15(): number[] { return list15.slice().concat(list15.toSorted()); }
function attack15(): number[] { return Array.prototype.slice.call({ length: 2, 0: 4294967296, 1: 4294967296 }) as number[]; }
for (let turn = 0; turn < 3; turn++) read15(plain15());
try { const c = attack15(); console.log('whole 4294967296 sliceOfArrayLike', read15(c), JSON.stringify(c), read15(list15), read15(plain15())); } catch (e) { console.log('whole 4294967296 sliceOfArrayLike threw', (e as Error).constructor.name); }
const list16: number[] = [1, 2, 3, 4];
function read16(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain16(): number[] { return list16.slice().concat(list16.toSorted()); }
function attack16(): number[] { return (function (..._: number[]) { return Array.prototype.slice.call(arguments) as number[]; })(4294967296, 4294967296); }
for (let turn = 0; turn < 3; turn++) read16(plain16());
try { const c = attack16(); console.log('whole 4294967296 sliceOfArguments', read16(c), JSON.stringify(c), read16(list16), read16(plain16())); } catch (e) { console.log('whole 4294967296 sliceOfArguments threw', (e as Error).constructor.name); }
const list17: number[] = [1, 2, 3, 4];
function read17(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain17(): number[] { return list17.slice().concat(list17.toSorted()); }
function attack17(): number[] { const inner = [4294967296]; return list17.concat(inner, [inner[0]]); }
for (let turn = 0; turn < 3; turn++) read17(plain17());
try { const c = attack17(); console.log('whole 4294967296 concatOfListOfList', read17(c), JSON.stringify(c), read17(list17), read17(plain17())); } catch (e) { console.log('whole 4294967296 concatOfListOfList threw', (e as Error).constructor.name); }
const list18: number[] = [1, 2, 3, 4];
function read18(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain18(): number[] { return list18.slice().concat(list18.toSorted()); }
function attack18(): number[] { const first = list18.concat(4294967296); return first.slice().slice(1).toReversed().toSorted().concat(); }
for (let turn = 0; turn < 3; turn++) read18(plain18());
try { const c = attack18(); console.log('whole 4294967296 sliceOfSlice', read18(c), JSON.stringify(c), read18(list18), read18(plain18())); } catch (e) { console.log('whole 4294967296 sliceOfSlice threw', (e as Error).constructor.name); }
const list19: number[] = [1, 2, 3, 4];
function read19(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain19(): number[] { return list19.slice().concat(list19.toSorted()); }
function attack19(): number[] { return list19.slice({ valueOf() { list19[0] = 4294967296; return 0; } } as any); }
for (let turn = 0; turn < 3; turn++) read19(plain19());
try { const c = attack19(); console.log('whole 4294967296 sliceValueOf', read19(c), JSON.stringify(c), read19(list19), read19(plain19())); } catch (e) { console.log('whole 4294967296 sliceValueOf threw', (e as Error).constructor.name); }
const list20: number[] = [1, 2, 3, 4];
function read20(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain20(): number[] { return list20.slice().concat(list20.toSorted()); }
function attack20(): number[] { return list20.with({ valueOf() { list20[1] = 4294967296; return 0; } } as any, 5); }
for (let turn = 0; turn < 3; turn++) read20(plain20());
try { const c = attack20(); console.log('whole 4294967296 withValueOf', read20(c), JSON.stringify(c), read20(list20), read20(plain20())); } catch (e) { console.log('whole 4294967296 withValueOf threw', (e as Error).constructor.name); }
const list21: number[] = [1, 2, 3, 4];
function read21(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain21(): number[] { return list21.slice().concat(list21.toSorted()); }
function attack21(): number[] { return list21.toSorted((a, b) => { list21[0] = 4294967296; return a - b; }).concat(list21); }
for (let turn = 0; turn < 3; turn++) read21(plain21());
try { const c = attack21(); console.log('whole 4294967296 toSortedComparator', read21(c), JSON.stringify(c), read21(list21), read21(plain21())); } catch (e) { console.log('whole 4294967296 toSortedComparator threw', (e as Error).constructor.name); }
const list22: number[] = [1, 2, 3, 4];
function read22(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain22(): number[] { return list22.slice().concat(list22.toSorted()); }
function attack22(): number[] { return list22.filter((x, i, list) => { list[i + 1] = 4294967296; return true; }); }
for (let turn = 0; turn < 3; turn++) read22(plain22());
try { const c = attack22(); console.log('whole 4294967296 filterCallback', read22(c), JSON.stringify(c), read22(list22), read22(plain22())); } catch (e) { console.log('whole 4294967296 filterCallback threw', (e as Error).constructor.name); }
const list23: number[] = [1, 2, 3, 4];
function read23(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain23(): number[] { return list23.slice().concat(list23.toSorted()); }
function attack23(): number[] { return list23.filter((x, i, list) => { if (i == 0) list.push(4294967296); return true; }).concat(list23); }
for (let turn = 0; turn < 3; turn++) read23(plain23());
try { const c = attack23(); console.log('whole 4294967296 filterCallbackPush', read23(c), JSON.stringify(c), read23(list23), read23(plain23())); } catch (e) { console.log('whole 4294967296 filterCallbackPush threw', (e as Error).constructor.name); }
const list24: number[] = [1, 2, 3, 4];
function read24(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain24(): number[] { return list24.slice().concat(list24.toSorted()); }
function attack24(): number[] { return list24.toSpliced(0, { valueOf() { list24[2] = 4294967296; return 0; } } as any); }
for (let turn = 0; turn < 3; turn++) read24(plain24());
try { const c = attack24(); console.log('whole 4294967296 toSplicedValueOf', read24(c), JSON.stringify(c), read24(list24), read24(plain24())); } catch (e) { console.log('whole 4294967296 toSplicedValueOf threw', (e as Error).constructor.name); }
const list25: number[] = [1, 2, 3, 4];
function read25(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain25(): number[] { return list25.slice().concat(list25.toSorted()); }
function attack25(): number[] { list25.fill(4294967296, 1, 2); return list25.slice(); }
for (let turn = 0; turn < 3; turn++) read25(plain25());
try { const c = attack25(); console.log('whole 4294967296 sourceFilled', read25(c), JSON.stringify(c), read25(list25), read25(plain25())); } catch (e) { console.log('whole 4294967296 sourceFilled threw', (e as Error).constructor.name); }
const list26: number[] = [1, 2, 3, 4];
function read26(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain26(): number[] { return list26.slice().concat(list26.toSorted()); }
function attack26(): number[] { Object.assign(list26, [4294967296]); return list26.toReversed(); }
for (let turn = 0; turn < 3; turn++) read26(plain26());
try { const c = attack26(); console.log('whole 4294967296 sourceAssigned', read26(c), JSON.stringify(c), read26(list26), read26(plain26())); } catch (e) { console.log('whole 4294967296 sourceAssigned threw', (e as Error).constructor.name); }
const list27: number[] = [1, 2, 3, 4];
function read27(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain27(): number[] { return list27.slice().concat(list27.toSorted()); }
function attack27(): number[] { Object.defineProperty(list27, 0, { value: 4294967296, writable: true, enumerable: true, configurable: true }); return list27.concat(); }
for (let turn = 0; turn < 3; turn++) read27(plain27());
try { const c = attack27(); console.log('whole 4294967296 sourceDefined', read27(c), JSON.stringify(c), read27(list27), read27(plain27())); } catch (e) { console.log('whole 4294967296 sourceDefined threw', (e as Error).constructor.name); }
const list28: number[] = [1, 2, 3, 4];
function read28(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain28(): number[] { return list28.slice().concat(list28.toSorted()); }
function attack28(): number[] { Object.defineProperty(list28, 0, { get() { return 4294967296; }, enumerable: true, configurable: true }); return list28.slice(); }
for (let turn = 0; turn < 3; turn++) read28(plain28());
try { const c = attack28(); console.log('whole 4294967296 sourceGetter', read28(c), JSON.stringify(c), read28(list28), read28(plain28())); } catch (e) { console.log('whole 4294967296 sourceGetter threw', (e as Error).constructor.name); }
const list29: number[] = [1, 2, 3, 4];
function read29(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain29(): number[] { return list29.slice().concat(list29.toSorted()); }
function attack29(): number[] { Reflect.set(list29, 0, 4294967296); return list29.toSorted(); }
for (let turn = 0; turn < 3; turn++) read29(plain29());
try { const c = attack29(); console.log('whole 4294967296 sourceReflectSet', read29(c), JSON.stringify(c), read29(list29), read29(plain29())); } catch (e) { console.log('whole 4294967296 sourceReflectSet threw', (e as Error).constructor.name); }
const list30: number[] = [1, 2, 3, 4];
function read30(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain30(): number[] { return list30.slice().concat(list30.toSorted()); }
function attack30(): number[] { list30.push.apply(list30, [4294967296]); return list30.slice(); }
for (let turn = 0; turn < 3; turn++) read30(plain30());
try { const c = attack30(); console.log('whole 4294967296 sourcePushApply', read30(c), JSON.stringify(c), read30(list30), read30(plain30())); } catch (e) { console.log('whole 4294967296 sourcePushApply threw', (e as Error).constructor.name); }
const list31: number[] = [1, 2, 3, 4];
function read31(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain31(): number[] { return list31.slice().concat(list31.toSorted()); }
function attack31(): number[] { list31.splice(0, 1, 4294967296); return list31.slice(); }
for (let turn = 0; turn < 3; turn++) read31(plain31());
try { const c = attack31(); console.log('whole 4294967296 sourceSpliced', read31(c), JSON.stringify(c), read31(list31), read31(plain31())); } catch (e) { console.log('whole 4294967296 sourceSpliced threw', (e as Error).constructor.name); }
const list32: number[] = [1, 2, 3, 4];
function read32(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain32(): number[] { return list32.slice().concat(list32.toSorted()); }
function attack32(): number[] { const any: any = list32; any[0] = 4294967296; return list32.slice(); }
for (let turn = 0; turn < 3; turn++) read32(plain32());
try { const c = attack32(); console.log('whole 4294967296 sourceThroughAny', read32(c), JSON.stringify(c), read32(list32), read32(plain32())); } catch (e) { console.log('whole 4294967296 sourceThroughAny threw', (e as Error).constructor.name); }
const list33: number[] = [1, 2, 3, 4];
function read33(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain33(): number[] { return list33.slice().concat(list33.toSorted()); }
function attack33(): number[] { storeInto(list33, 4294967296); return list33.with(1, 2); }
for (let turn = 0; turn < 3; turn++) read33(plain33());
try { const c = attack33(); console.log('whole 4294967296 sourceThroughAFunction', read33(c), JSON.stringify(c), read33(list33), read33(plain33())); } catch (e) { console.log('whole 4294967296 sourceThroughAFunction threw', (e as Error).constructor.name); }
const list34: number[] = [1, 2, 3, 4];
function read34(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain34(): number[] { return list34.slice().concat(list34.toSorted()); }
function attack34(): number[] { list34.push(4294967296); list34.copyWithin(0, list34.length - 1); return list34.slice(0, 2); }
for (let turn = 0; turn < 3; turn++) read34(plain34());
try { const c = attack34(); console.log('whole 4294967296 sourceCopyWithin', read34(c), JSON.stringify(c), read34(list34), read34(plain34())); } catch (e) { console.log('whole 4294967296 sourceCopyWithin threw', (e as Error).constructor.name); }
const list35: number[] = [1, 2, 3, 4];
function read35(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain35(): number[] { return list35.slice().concat(list35.toSorted()); }
function attack35(): number[] { const other = [4294967296]; list35.push(...other); return list35.filter(() => true); }
for (let turn = 0; turn < 3; turn++) read35(plain35());
try { const c = attack35(); console.log('whole 4294967296 sourceSpreadInto', read35(c), JSON.stringify(c), read35(list35), read35(plain35())); } catch (e) { console.log('whole 4294967296 sourceSpreadInto threw', (e as Error).constructor.name); }
const list36: number[] = [1, 2, 3, 4];
function read36(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain36(): number[] { return list36.slice().concat(list36.toSorted()); }
function attack36(): number[] { const other = [4294967296]; const source = [...list36, ...other]; return source.slice(); }
for (let turn = 0; turn < 3; turn++) read36(plain36());
try { const c = attack36(); console.log('whole 4294967296 sourceIsSpread', read36(c), JSON.stringify(c), read36(list36), read36(plain36())); } catch (e) { console.log('whole 4294967296 sourceIsSpread threw', (e as Error).constructor.name); }
const list37: number[] = [1, 2, 3, 4];
function read37(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain37(): number[] { return list37.slice().concat(list37.toSorted()); }
function attack37(): number[] { const source = Array.from(list37, () => 4294967296); return source.slice(); }
for (let turn = 0; turn < 3; turn++) read37(plain37());
try { const c = attack37(); console.log('whole 4294967296 sourceIsFrom', read37(c), JSON.stringify(c), read37(list37), read37(plain37())); } catch (e) { console.log('whole 4294967296 sourceIsFrom threw', (e as Error).constructor.name); }
const list38: number[] = [1, 2, 3, 4];
function read38(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain38(): number[] { return list38.slice().concat(list38.toSorted()); }
function attack38(): number[] { const source = list38.map(() => 4294967296); return source.concat(list38); }
for (let turn = 0; turn < 3; turn++) read38(plain38());
try { const c = attack38(); console.log('whole 4294967296 sourceIsMapped', read38(c), JSON.stringify(c), read38(list38), read38(plain38())); } catch (e) { console.log('whole 4294967296 sourceIsMapped threw', (e as Error).constructor.name); }
const list39: number[] = [1, 2, 3, 4];
function read39(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain39(): number[] { return list39.slice().concat(list39.toSorted()); }
function attack39(): number[] { list39.length = 6; return list39.slice(); }
for (let turn = 0; turn < 3; turn++) read39(plain39());
try { const c = attack39(); console.log('whole 4294967296 sourceLengthened', read39(c), JSON.stringify(c), read39(list39), read39(plain39())); } catch (e) { console.log('whole 4294967296 sourceLengthened threw', (e as Error).constructor.name); }
const list40: number[] = [1, 2, 3, 4];
function read40(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain40(): number[] { return list40.slice().concat(list40.toSorted()); }
function attack40(): number[] { return list40.slice().fill(4294967296); }
for (let turn = 0; turn < 3; turn++) read40(plain40());
try { const c = attack40(); console.log('whole 4294967296 copyFilled', read40(c), JSON.stringify(c), read40(list40), read40(plain40())); } catch (e) { console.log('whole 4294967296 copyFilled threw', (e as Error).constructor.name); }
const list41: number[] = [1, 2, 3, 4];
function read41(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain41(): number[] { return list41.slice().concat(list41.toSorted()); }
function attack41(): number[] { return Object.assign(list41.slice(), [4294967296]); }
for (let turn = 0; turn < 3; turn++) read41(plain41());
try { const c = attack41(); console.log('whole 4294967296 copyAssigned', read41(c), JSON.stringify(c), read41(list41), read41(plain41())); } catch (e) { console.log('whole 4294967296 copyAssigned threw', (e as Error).constructor.name); }
const list42: number[] = [1, 2, 3, 4];
function read42(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain42(): number[] { return list42.slice().concat(list42.toSorted()); }
function attack42(): number[] { const c = list42.concat(); c.push.apply(c, [4294967296]); return c; }
for (let turn = 0; turn < 3; turn++) read42(plain42());
try { const c = attack42(); console.log('whole 4294967296 copyPushApply', read42(c), JSON.stringify(c), read42(list42), read42(plain42())); } catch (e) { console.log('whole 4294967296 copyPushApply threw', (e as Error).constructor.name); }
const list43: number[] = [1, 2, 3, 4];
function read43(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain43(): number[] { return list43.slice().concat(list43.toSorted()); }
function attack43(): number[] { const c: any = list43.toSorted(); c[0] = 4294967296; return c; }
for (let turn = 0; turn < 3; turn++) read43(plain43());
try { const c = attack43(); console.log('whole 4294967296 copyThroughAny', read43(c), JSON.stringify(c), read43(list43), read43(plain43())); } catch (e) { console.log('whole 4294967296 copyThroughAny threw', (e as Error).constructor.name); }
const list44: number[] = [1, 2, 3, 4];
function read44(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain44(): number[] { return list44.slice().concat(list44.toSorted()); }
function attack44(): number[] { const c = list44.toReversed(); c[0] = 4294967296; return c; }
for (let turn = 0; turn < 3; turn++) read44(plain44());
try { const c = attack44(); console.log('whole 4294967296 copyStored', read44(c), JSON.stringify(c), read44(list44), read44(plain44())); } catch (e) { console.log('whole 4294967296 copyStored threw', (e as Error).constructor.name); }
const list45: number[] = [1, 2, 3, 4];
function read45(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain45(): number[] { return list45.slice().concat(list45.toSorted()); }
function attack45(): number[] { const c = list45.slice(); kept.push(c); kept[kept.length - 1][0] = 4294967296; return c; }
for (let turn = 0; turn < 3; turn++) read45(plain45());
try { const c = attack45(); console.log('whole 4294967296 copyKeptAndStoredLater', read45(c), JSON.stringify(c), read45(list45), read45(plain45())); } catch (e) { console.log('whole 4294967296 copyKeptAndStoredLater threw', (e as Error).constructor.name); }
const list46: number[] = [1, 2, 3, 4];
function read46(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain46(): number[] { return list46.slice().concat(list46.toSorted()); }
function attack46(): number[] { const c = list46.slice(); c.splice(1, 0, 4294967296); return c; }
for (let turn = 0; turn < 3; turn++) read46(plain46());
try { const c = attack46(); console.log('whole 4294967296 copySpliced', read46(c), JSON.stringify(c), read46(list46), read46(plain46())); } catch (e) { console.log('whole 4294967296 copySpliced threw', (e as Error).constructor.name); }
const list49: number[] = [1, 2, 3, 4];
function read49(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain49(): number[] { return list49.slice().concat(list49.toSorted()); }
function attack49(): number[] { const victim = [0.5]; (list49 as any).constructor = { [Symbol.species]: function () { return victim; } }; list49.push(4294967296); list49.slice(); return victim; }
for (let turn = 0; turn < 3; turn++) read49(plain49());
try { const c = attack49(); console.log('whole 4294967296 species', read49(c), JSON.stringify(c), read49(list49), read49(plain49())); } catch (e) { console.log('whole 4294967296 species threw', (e as Error).constructor.name); }
const list50: number[] = [1, 2, 3, 4];
function read50(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain50(): number[] { return list50.slice().concat(list50.toSorted()); }
function attack50(): number[] { class Heir extends Array<number> {} const h = Heir.from(list50) as Heir; h.push(4294967296); return h.slice(); }
for (let turn = 0; turn < 3; turn++) read50(plain50());
try { const c = attack50(); console.log('whole 4294967296 heir', read50(c), JSON.stringify(c), read50(list50), read50(plain50())); } catch (e) { console.log('whole 4294967296 heir threw', (e as Error).constructor.name); }
const list51: number[] = [1, 2, 3, 4];
function read51(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain51(): number[] { return list51.slice().concat(list51.toSorted()); }
function attack51(): number[] { return Array.prototype.concat.apply(list51, [7.25]) as number[]; }
for (let turn = 0; turn < 3; turn++) read51(plain51());
try { const c = attack51(); console.log('whole 7.25 concatApply', read51(c), JSON.stringify(c), read51(list51), read51(plain51())); } catch (e) { console.log('whole 7.25 concatApply threw', (e as Error).constructor.name); }
const list52: number[] = [1, 2, 3, 4];
function read52(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain52(): number[] { return list52.slice().concat(list52.toSorted()); }
function attack52(): number[] { return Array.prototype.concat.call(list52, 7.25) as number[]; }
for (let turn = 0; turn < 3; turn++) read52(plain52());
try { const c = attack52(); console.log('whole 7.25 concatCall', read52(c), JSON.stringify(c), read52(list52), read52(plain52())); } catch (e) { console.log('whole 7.25 concatCall threw', (e as Error).constructor.name); }
const list53: number[] = [1, 2, 3, 4];
function read53(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain53(): number[] { return list53.slice().concat(list53.toSorted()); }
function attack53(): number[] { const more = [7.25]; return list53.concat(...more); }
for (let turn = 0; turn < 3; turn++) read53(plain53());
try { const c = attack53(); console.log('whole 7.25 concatSpreadCall', read53(c), JSON.stringify(c), read53(list53), read53(plain53())); } catch (e) { console.log('whole 7.25 concatSpreadCall threw', (e as Error).constructor.name); }
const list54: number[] = [1, 2, 3, 4];
function read54(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain54(): number[] { return list54.slice().concat(list54.toSorted()); }
function attack54(): number[] { return (list54.concat.bind(list54, 7.25) as () => number[])(); }
for (let turn = 0; turn < 3; turn++) read54(plain54());
try { const c = attack54(); console.log('whole 7.25 concatBound', read54(c), JSON.stringify(c), read54(list54), read54(plain54())); } catch (e) { console.log('whole 7.25 concatBound threw', (e as Error).constructor.name); }
const list55: number[] = [1, 2, 3, 4];
function read55(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain55(): number[] { return list55.slice().concat(list55.toSorted()); }
function attack55(): number[] { return Reflect.apply(Array.prototype.concat, list55, [7.25]) as number[]; }
for (let turn = 0; turn < 3; turn++) read55(plain55());
try { const c = attack55(); console.log('whole 7.25 concatReflect', read55(c), JSON.stringify(c), read55(list55), read55(plain55())); } catch (e) { console.log('whole 7.25 concatReflect threw', (e as Error).constructor.name); }
const list56: number[] = [1, 2, 3, 4];
function read56(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain56(): number[] { return list56.slice().concat(list56.toSorted()); }
function attack56(): number[] { return (Array.prototype.with as Function).apply(list56, [0, 7.25]) as number[]; }
for (let turn = 0; turn < 3; turn++) read56(plain56());
try { const c = attack56(); console.log('whole 7.25 withApply', read56(c), JSON.stringify(c), read56(list56), read56(plain56())); } catch (e) { console.log('whole 7.25 withApply threw', (e as Error).constructor.name); }
const list57: number[] = [1, 2, 3, 4];
function read57(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain57(): number[] { return list57.slice().concat(list57.toSorted()); }
function attack57(): number[] { return (Array.prototype.with as Function).call(list57, 0, 7.25) as number[]; }
for (let turn = 0; turn < 3; turn++) read57(plain57());
try { const c = attack57(); console.log('whole 7.25 withCall', read57(c), JSON.stringify(c), read57(list57), read57(plain57())); } catch (e) { console.log('whole 7.25 withCall threw', (e as Error).constructor.name); }
const list58: number[] = [1, 2, 3, 4];
function read58(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain58(): number[] { return list58.slice().concat(list58.toSorted()); }
function attack58(): number[] { return Reflect.apply(Array.prototype.with, list58, [0, 7.25]) as number[]; }
for (let turn = 0; turn < 3; turn++) read58(plain58());
try { const c = attack58(); console.log('whole 7.25 withReflect', read58(c), JSON.stringify(c), read58(list58), read58(plain58())); } catch (e) { console.log('whole 7.25 withReflect threw', (e as Error).constructor.name); }
const list59: number[] = [1, 2, 3, 4];
function read59(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain59(): number[] { return list59.slice().concat(list59.toSorted()); }
function attack59(): number[] { return (Array.prototype.toSpliced as Function).apply(list59, [0, 1, 7.25]) as number[]; }
for (let turn = 0; turn < 3; turn++) read59(plain59());
try { const c = attack59(); console.log('whole 7.25 toSplicedApply', read59(c), JSON.stringify(c), read59(list59), read59(plain59())); } catch (e) { console.log('whole 7.25 toSplicedApply threw', (e as Error).constructor.name); }
const list60: number[] = [1, 2, 3, 4];
function read60(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain60(): number[] { return list60.slice().concat(list60.toSorted()); }
function attack60(): number[] { const more = [7.25, 7.25]; return list60.toSpliced(0, 1, ...more); }
for (let turn = 0; turn < 3; turn++) read60(plain60());
try { const c = attack60(); console.log('whole 7.25 toSplicedSpread', read60(c), JSON.stringify(c), read60(list60), read60(plain60())); } catch (e) { console.log('whole 7.25 toSplicedSpread threw', (e as Error).constructor.name); }
const list61: number[] = [1, 2, 3, 4];
function read61(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain61(): number[] { return list61.slice().concat(list61.toSorted()); }
function attack61(): number[] { const method = list61.with; return method.call(list61, 1, 7.25); }
for (let turn = 0; turn < 3; turn++) read61(plain61());
try { const c = attack61(); console.log('whole 7.25 withThroughAVariable', read61(c), JSON.stringify(c), read61(list61), read61(plain61())); } catch (e) { console.log('whole 7.25 withThroughAVariable threw', (e as Error).constructor.name); }
const list62: number[] = [1, 2, 3, 4];
function read62(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain62(): number[] { return list62.slice().concat(list62.toSorted()); }
function attack62(): number[] { const any: any = list62; return any.concat(7.25); }
for (let turn = 0; turn < 3; turn++) read62(plain62());
try { const c = attack62(); console.log('whole 7.25 concatThroughAny', read62(c), JSON.stringify(c), read62(list62), read62(plain62())); } catch (e) { console.log('whole 7.25 concatThroughAny threw', (e as Error).constructor.name); }
const list63: number[] = [1, 2, 3, 4];
function read63(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain63(): number[] { return list63.slice().concat(list63.toSorted()); }
function attack63(): number[] { const name = 'con' + 'cat'; return (list63 as any)[name](7.25); }
for (let turn = 0; turn < 3; turn++) read63(plain63());
try { const c = attack63(); console.log('whole 7.25 concatByName', read63(c), JSON.stringify(c), read63(list63), read63(plain63())); } catch (e) { console.log('whole 7.25 concatByName threw', (e as Error).constructor.name); }
const list64: number[] = [1, 2, 3, 4];
function read64(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain64(): number[] { return list64.slice().concat(list64.toSorted()); }
function attack64(): number[] { return list64.concat({ length: 1, 0: 7.25, [Symbol.isConcatSpreadable]: true } as any); }
for (let turn = 0; turn < 3; turn++) read64(plain64());
try { const c = attack64(); console.log('whole 7.25 concatSpreadable', read64(c), JSON.stringify(c), read64(list64), read64(plain64())); } catch (e) { console.log('whole 7.25 concatSpreadable threw', (e as Error).constructor.name); }
const list65: number[] = [1, 2, 3, 4];
function read65(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain65(): number[] { return list65.slice().concat(list65.toSorted()); }
function attack65(): number[] { return Array.prototype.slice.call({ length: 2, 0: 7.25, 1: 7.25 }) as number[]; }
for (let turn = 0; turn < 3; turn++) read65(plain65());
try { const c = attack65(); console.log('whole 7.25 sliceOfArrayLike', read65(c), JSON.stringify(c), read65(list65), read65(plain65())); } catch (e) { console.log('whole 7.25 sliceOfArrayLike threw', (e as Error).constructor.name); }
const list66: number[] = [1, 2, 3, 4];
function read66(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain66(): number[] { return list66.slice().concat(list66.toSorted()); }
function attack66(): number[] { return (function (..._: number[]) { return Array.prototype.slice.call(arguments) as number[]; })(7.25, 7.25); }
for (let turn = 0; turn < 3; turn++) read66(plain66());
try { const c = attack66(); console.log('whole 7.25 sliceOfArguments', read66(c), JSON.stringify(c), read66(list66), read66(plain66())); } catch (e) { console.log('whole 7.25 sliceOfArguments threw', (e as Error).constructor.name); }
const list67: number[] = [1, 2, 3, 4];
function read67(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain67(): number[] { return list67.slice().concat(list67.toSorted()); }
function attack67(): number[] { const inner = [7.25]; return list67.concat(inner, [inner[0]]); }
for (let turn = 0; turn < 3; turn++) read67(plain67());
try { const c = attack67(); console.log('whole 7.25 concatOfListOfList', read67(c), JSON.stringify(c), read67(list67), read67(plain67())); } catch (e) { console.log('whole 7.25 concatOfListOfList threw', (e as Error).constructor.name); }
const list68: number[] = [1, 2, 3, 4];
function read68(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain68(): number[] { return list68.slice().concat(list68.toSorted()); }
function attack68(): number[] { const first = list68.concat(7.25); return first.slice().slice(1).toReversed().toSorted().concat(); }
for (let turn = 0; turn < 3; turn++) read68(plain68());
try { const c = attack68(); console.log('whole 7.25 sliceOfSlice', read68(c), JSON.stringify(c), read68(list68), read68(plain68())); } catch (e) { console.log('whole 7.25 sliceOfSlice threw', (e as Error).constructor.name); }
const list69: number[] = [1, 2, 3, 4];
function read69(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain69(): number[] { return list69.slice().concat(list69.toSorted()); }
function attack69(): number[] { return list69.slice({ valueOf() { list69[0] = 7.25; return 0; } } as any); }
for (let turn = 0; turn < 3; turn++) read69(plain69());
try { const c = attack69(); console.log('whole 7.25 sliceValueOf', read69(c), JSON.stringify(c), read69(list69), read69(plain69())); } catch (e) { console.log('whole 7.25 sliceValueOf threw', (e as Error).constructor.name); }
const list70: number[] = [1, 2, 3, 4];
function read70(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain70(): number[] { return list70.slice().concat(list70.toSorted()); }
function attack70(): number[] { return list70.with({ valueOf() { list70[1] = 7.25; return 0; } } as any, 5); }
for (let turn = 0; turn < 3; turn++) read70(plain70());
try { const c = attack70(); console.log('whole 7.25 withValueOf', read70(c), JSON.stringify(c), read70(list70), read70(plain70())); } catch (e) { console.log('whole 7.25 withValueOf threw', (e as Error).constructor.name); }
const list71: number[] = [1, 2, 3, 4];
function read71(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain71(): number[] { return list71.slice().concat(list71.toSorted()); }
function attack71(): number[] { return list71.toSorted((a, b) => { list71[0] = 7.25; return a - b; }).concat(list71); }
for (let turn = 0; turn < 3; turn++) read71(plain71());
try { const c = attack71(); console.log('whole 7.25 toSortedComparator', read71(c), JSON.stringify(c), read71(list71), read71(plain71())); } catch (e) { console.log('whole 7.25 toSortedComparator threw', (e as Error).constructor.name); }
const list72: number[] = [1, 2, 3, 4];
function read72(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain72(): number[] { return list72.slice().concat(list72.toSorted()); }
function attack72(): number[] { return list72.filter((x, i, list) => { list[i + 1] = 7.25; return true; }); }
for (let turn = 0; turn < 3; turn++) read72(plain72());
try { const c = attack72(); console.log('whole 7.25 filterCallback', read72(c), JSON.stringify(c), read72(list72), read72(plain72())); } catch (e) { console.log('whole 7.25 filterCallback threw', (e as Error).constructor.name); }
const list73: number[] = [1, 2, 3, 4];
function read73(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain73(): number[] { return list73.slice().concat(list73.toSorted()); }
function attack73(): number[] { return list73.filter((x, i, list) => { if (i == 0) list.push(7.25); return true; }).concat(list73); }
for (let turn = 0; turn < 3; turn++) read73(plain73());
try { const c = attack73(); console.log('whole 7.25 filterCallbackPush', read73(c), JSON.stringify(c), read73(list73), read73(plain73())); } catch (e) { console.log('whole 7.25 filterCallbackPush threw', (e as Error).constructor.name); }
const list74: number[] = [1, 2, 3, 4];
function read74(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain74(): number[] { return list74.slice().concat(list74.toSorted()); }
function attack74(): number[] { return list74.toSpliced(0, { valueOf() { list74[2] = 7.25; return 0; } } as any); }
for (let turn = 0; turn < 3; turn++) read74(plain74());
try { const c = attack74(); console.log('whole 7.25 toSplicedValueOf', read74(c), JSON.stringify(c), read74(list74), read74(plain74())); } catch (e) { console.log('whole 7.25 toSplicedValueOf threw', (e as Error).constructor.name); }
const list75: number[] = [1, 2, 3, 4];
function read75(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain75(): number[] { return list75.slice().concat(list75.toSorted()); }
function attack75(): number[] { list75.fill(7.25, 1, 2); return list75.slice(); }
for (let turn = 0; turn < 3; turn++) read75(plain75());
try { const c = attack75(); console.log('whole 7.25 sourceFilled', read75(c), JSON.stringify(c), read75(list75), read75(plain75())); } catch (e) { console.log('whole 7.25 sourceFilled threw', (e as Error).constructor.name); }
const list76: number[] = [1, 2, 3, 4];
function read76(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain76(): number[] { return list76.slice().concat(list76.toSorted()); }
function attack76(): number[] { Object.assign(list76, [7.25]); return list76.toReversed(); }
for (let turn = 0; turn < 3; turn++) read76(plain76());
try { const c = attack76(); console.log('whole 7.25 sourceAssigned', read76(c), JSON.stringify(c), read76(list76), read76(plain76())); } catch (e) { console.log('whole 7.25 sourceAssigned threw', (e as Error).constructor.name); }
const list77: number[] = [1, 2, 3, 4];
function read77(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain77(): number[] { return list77.slice().concat(list77.toSorted()); }
function attack77(): number[] { Object.defineProperty(list77, 0, { value: 7.25, writable: true, enumerable: true, configurable: true }); return list77.concat(); }
for (let turn = 0; turn < 3; turn++) read77(plain77());
try { const c = attack77(); console.log('whole 7.25 sourceDefined', read77(c), JSON.stringify(c), read77(list77), read77(plain77())); } catch (e) { console.log('whole 7.25 sourceDefined threw', (e as Error).constructor.name); }
const list78: number[] = [1, 2, 3, 4];
function read78(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain78(): number[] { return list78.slice().concat(list78.toSorted()); }
function attack78(): number[] { Object.defineProperty(list78, 0, { get() { return 7.25; }, enumerable: true, configurable: true }); return list78.slice(); }
for (let turn = 0; turn < 3; turn++) read78(plain78());
try { const c = attack78(); console.log('whole 7.25 sourceGetter', read78(c), JSON.stringify(c), read78(list78), read78(plain78())); } catch (e) { console.log('whole 7.25 sourceGetter threw', (e as Error).constructor.name); }
const list79: number[] = [1, 2, 3, 4];
function read79(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain79(): number[] { return list79.slice().concat(list79.toSorted()); }
function attack79(): number[] { Reflect.set(list79, 0, 7.25); return list79.toSorted(); }
for (let turn = 0; turn < 3; turn++) read79(plain79());
try { const c = attack79(); console.log('whole 7.25 sourceReflectSet', read79(c), JSON.stringify(c), read79(list79), read79(plain79())); } catch (e) { console.log('whole 7.25 sourceReflectSet threw', (e as Error).constructor.name); }
const list80: number[] = [1, 2, 3, 4];
function read80(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain80(): number[] { return list80.slice().concat(list80.toSorted()); }
function attack80(): number[] { list80.push.apply(list80, [7.25]); return list80.slice(); }
for (let turn = 0; turn < 3; turn++) read80(plain80());
try { const c = attack80(); console.log('whole 7.25 sourcePushApply', read80(c), JSON.stringify(c), read80(list80), read80(plain80())); } catch (e) { console.log('whole 7.25 sourcePushApply threw', (e as Error).constructor.name); }
const list81: number[] = [1, 2, 3, 4];
function read81(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain81(): number[] { return list81.slice().concat(list81.toSorted()); }
function attack81(): number[] { list81.splice(0, 1, 7.25); return list81.slice(); }
for (let turn = 0; turn < 3; turn++) read81(plain81());
try { const c = attack81(); console.log('whole 7.25 sourceSpliced', read81(c), JSON.stringify(c), read81(list81), read81(plain81())); } catch (e) { console.log('whole 7.25 sourceSpliced threw', (e as Error).constructor.name); }
const list82: number[] = [1, 2, 3, 4];
function read82(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain82(): number[] { return list82.slice().concat(list82.toSorted()); }
function attack82(): number[] { const any: any = list82; any[0] = 7.25; return list82.slice(); }
for (let turn = 0; turn < 3; turn++) read82(plain82());
try { const c = attack82(); console.log('whole 7.25 sourceThroughAny', read82(c), JSON.stringify(c), read82(list82), read82(plain82())); } catch (e) { console.log('whole 7.25 sourceThroughAny threw', (e as Error).constructor.name); }
const list83: number[] = [1, 2, 3, 4];
function read83(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain83(): number[] { return list83.slice().concat(list83.toSorted()); }
function attack83(): number[] { storeInto(list83, 7.25); return list83.with(1, 2); }
for (let turn = 0; turn < 3; turn++) read83(plain83());
try { const c = attack83(); console.log('whole 7.25 sourceThroughAFunction', read83(c), JSON.stringify(c), read83(list83), read83(plain83())); } catch (e) { console.log('whole 7.25 sourceThroughAFunction threw', (e as Error).constructor.name); }
const list84: number[] = [1, 2, 3, 4];
function read84(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain84(): number[] { return list84.slice().concat(list84.toSorted()); }
function attack84(): number[] { list84.push(7.25); list84.copyWithin(0, list84.length - 1); return list84.slice(0, 2); }
for (let turn = 0; turn < 3; turn++) read84(plain84());
try { const c = attack84(); console.log('whole 7.25 sourceCopyWithin', read84(c), JSON.stringify(c), read84(list84), read84(plain84())); } catch (e) { console.log('whole 7.25 sourceCopyWithin threw', (e as Error).constructor.name); }
const list85: number[] = [1, 2, 3, 4];
function read85(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain85(): number[] { return list85.slice().concat(list85.toSorted()); }
function attack85(): number[] { const other = [7.25]; list85.push(...other); return list85.filter(() => true); }
for (let turn = 0; turn < 3; turn++) read85(plain85());
try { const c = attack85(); console.log('whole 7.25 sourceSpreadInto', read85(c), JSON.stringify(c), read85(list85), read85(plain85())); } catch (e) { console.log('whole 7.25 sourceSpreadInto threw', (e as Error).constructor.name); }
const list86: number[] = [1, 2, 3, 4];
function read86(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain86(): number[] { return list86.slice().concat(list86.toSorted()); }
function attack86(): number[] { const other = [7.25]; const source = [...list86, ...other]; return source.slice(); }
for (let turn = 0; turn < 3; turn++) read86(plain86());
try { const c = attack86(); console.log('whole 7.25 sourceIsSpread', read86(c), JSON.stringify(c), read86(list86), read86(plain86())); } catch (e) { console.log('whole 7.25 sourceIsSpread threw', (e as Error).constructor.name); }
const list87: number[] = [1, 2, 3, 4];
function read87(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain87(): number[] { return list87.slice().concat(list87.toSorted()); }
function attack87(): number[] { const source = Array.from(list87, () => 7.25); return source.slice(); }
for (let turn = 0; turn < 3; turn++) read87(plain87());
try { const c = attack87(); console.log('whole 7.25 sourceIsFrom', read87(c), JSON.stringify(c), read87(list87), read87(plain87())); } catch (e) { console.log('whole 7.25 sourceIsFrom threw', (e as Error).constructor.name); }
const list88: number[] = [1, 2, 3, 4];
function read88(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain88(): number[] { return list88.slice().concat(list88.toSorted()); }
function attack88(): number[] { const source = list88.map(() => 7.25); return source.concat(list88); }
for (let turn = 0; turn < 3; turn++) read88(plain88());
try { const c = attack88(); console.log('whole 7.25 sourceIsMapped', read88(c), JSON.stringify(c), read88(list88), read88(plain88())); } catch (e) { console.log('whole 7.25 sourceIsMapped threw', (e as Error).constructor.name); }
const list89: number[] = [1, 2, 3, 4];
function read89(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain89(): number[] { return list89.slice().concat(list89.toSorted()); }
function attack89(): number[] { list89.length = 6; return list89.slice(); }
for (let turn = 0; turn < 3; turn++) read89(plain89());
try { const c = attack89(); console.log('whole 7.25 sourceLengthened', read89(c), JSON.stringify(c), read89(list89), read89(plain89())); } catch (e) { console.log('whole 7.25 sourceLengthened threw', (e as Error).constructor.name); }
const list90: number[] = [1, 2, 3, 4];
function read90(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain90(): number[] { return list90.slice().concat(list90.toSorted()); }
function attack90(): number[] { return list90.slice().fill(7.25); }
for (let turn = 0; turn < 3; turn++) read90(plain90());
try { const c = attack90(); console.log('whole 7.25 copyFilled', read90(c), JSON.stringify(c), read90(list90), read90(plain90())); } catch (e) { console.log('whole 7.25 copyFilled threw', (e as Error).constructor.name); }
const list91: number[] = [1, 2, 3, 4];
function read91(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain91(): number[] { return list91.slice().concat(list91.toSorted()); }
function attack91(): number[] { return Object.assign(list91.slice(), [7.25]); }
for (let turn = 0; turn < 3; turn++) read91(plain91());
try { const c = attack91(); console.log('whole 7.25 copyAssigned', read91(c), JSON.stringify(c), read91(list91), read91(plain91())); } catch (e) { console.log('whole 7.25 copyAssigned threw', (e as Error).constructor.name); }
const list92: number[] = [1, 2, 3, 4];
function read92(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain92(): number[] { return list92.slice().concat(list92.toSorted()); }
function attack92(): number[] { const c = list92.concat(); c.push.apply(c, [7.25]); return c; }
for (let turn = 0; turn < 3; turn++) read92(plain92());
try { const c = attack92(); console.log('whole 7.25 copyPushApply', read92(c), JSON.stringify(c), read92(list92), read92(plain92())); } catch (e) { console.log('whole 7.25 copyPushApply threw', (e as Error).constructor.name); }
const list93: number[] = [1, 2, 3, 4];
function read93(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain93(): number[] { return list93.slice().concat(list93.toSorted()); }
function attack93(): number[] { const c: any = list93.toSorted(); c[0] = 7.25; return c; }
for (let turn = 0; turn < 3; turn++) read93(plain93());
try { const c = attack93(); console.log('whole 7.25 copyThroughAny', read93(c), JSON.stringify(c), read93(list93), read93(plain93())); } catch (e) { console.log('whole 7.25 copyThroughAny threw', (e as Error).constructor.name); }
const list94: number[] = [1, 2, 3, 4];
function read94(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain94(): number[] { return list94.slice().concat(list94.toSorted()); }
function attack94(): number[] { const c = list94.toReversed(); c[0] = 7.25; return c; }
for (let turn = 0; turn < 3; turn++) read94(plain94());
try { const c = attack94(); console.log('whole 7.25 copyStored', read94(c), JSON.stringify(c), read94(list94), read94(plain94())); } catch (e) { console.log('whole 7.25 copyStored threw', (e as Error).constructor.name); }
const list95: number[] = [1, 2, 3, 4];
function read95(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain95(): number[] { return list95.slice().concat(list95.toSorted()); }
function attack95(): number[] { const c = list95.slice(); kept.push(c); kept[kept.length - 1][0] = 7.25; return c; }
for (let turn = 0; turn < 3; turn++) read95(plain95());
try { const c = attack95(); console.log('whole 7.25 copyKeptAndStoredLater', read95(c), JSON.stringify(c), read95(list95), read95(plain95())); } catch (e) { console.log('whole 7.25 copyKeptAndStoredLater threw', (e as Error).constructor.name); }
const list96: number[] = [1, 2, 3, 4];
function read96(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain96(): number[] { return list96.slice().concat(list96.toSorted()); }
function attack96(): number[] { const c = list96.slice(); c.splice(1, 0, 7.25); return c; }
for (let turn = 0; turn < 3; turn++) read96(plain96());
try { const c = attack96(); console.log('whole 7.25 copySpliced', read96(c), JSON.stringify(c), read96(list96), read96(plain96())); } catch (e) { console.log('whole 7.25 copySpliced threw', (e as Error).constructor.name); }
const list99: number[] = [1, 2, 3, 4];
function read99(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain99(): number[] { return list99.slice().concat(list99.toSorted()); }
function attack99(): number[] { const victim = [0.5]; (list99 as any).constructor = { [Symbol.species]: function () { return victim; } }; list99.push(7.25); list99.slice(); return victim; }
for (let turn = 0; turn < 3; turn++) read99(plain99());
try { const c = attack99(); console.log('whole 7.25 species', read99(c), JSON.stringify(c), read99(list99), read99(plain99())); } catch (e) { console.log('whole 7.25 species threw', (e as Error).constructor.name); }
const list100: number[] = [1, 2, 3, 4];
function read100(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function plain100(): number[] { return list100.slice().concat(list100.toSorted()); }
function attack100(): number[] { class Heir extends Array<number> {} const h = Heir.from(list100) as Heir; h.push(7.25); return h.slice(); }
for (let turn = 0; turn < 3; turn++) read100(plain100());
try { const c = attack100(); console.log('whole 7.25 heir', read100(c), JSON.stringify(c), read100(list100), read100(plain100())); } catch (e) { console.log('whole 7.25 heir threw', (e as Error).constructor.name); }
export {};
