// What is read from a list and stored again adds no number that the list read from does not hold: every place that such a read may take another number from.
let turns = 0;
function first(list: number[]): number { return list[0]; }
function storeInto(list: number[], value: number): void { list[0] = value; }
function show(x: number): string { return Object.is(x, -0) ? '-0' : String(x); }
const list1: number[] = [1, 2, 3, 4];
function read1(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap1(): void { const held = list1[0]; list1[0] = list1[1]; list1[1] = held; }
function attack1(): void { const other = new Float64Array([4294967296, 4294967296]); list1[0] = other[0]; list1[1] = other[1]!; }
for (let turn = 0; turn < 4; turn++) { swap1(); read1(list1); }
try { attack1(); swap1(); console.log('4294967296 fromBytes', read1(list1), JSON.stringify(list1)); } catch (e) { console.log('4294967296 fromBytes threw', (e as Error).constructor.name); }
const list2: number[] = [1, 2, 3, 4];
function read2(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap2(): void { const held = list2[0]; list2[0] = list2[1]; list2[1] = held; }
function attack2(): void { const other = new Uint32Array([4294967295]); list2[0] = other[0]; list2[1] = 4294967296; }
for (let turn = 0; turn < 4; turn++) { swap2(); read2(list2); }
try { attack2(); swap2(); console.log('4294967296 fromBigInts32', read2(list2), JSON.stringify(list2)); } catch (e) { console.log('4294967296 fromBigInts32 threw', (e as Error).constructor.name); }
const list3: number[] = [1, 2, 3, 4];
function read3(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap3(): void { const held = list3[0]; list3[0] = list3[1]; list3[1] = held; }
function attack3(): void { const other: ArrayLike<number> = { length: 1, 0: 4294967296 }; list3[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap3(); read3(list3); }
try { attack3(); swap3(); console.log('4294967296 fromArrayLike', read3(list3), JSON.stringify(list3)); } catch (e) { console.log('4294967296 fromArrayLike threw', (e as Error).constructor.name); }
const list4: number[] = [1, 2, 3, 4];
function read4(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap4(): void { const held = list4[0]; list4[0] = list4[1]; list4[1] = held; }
function attack4(): void { const other: Record<number, number> = { 0: 4294967296 }; list4[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap4(); read4(list4); }
try { attack4(); swap4(); console.log('4294967296 fromRecord', read4(list4), JSON.stringify(list4)); } catch (e) { console.log('4294967296 fromRecord threw', (e as Error).constructor.name); }
const list5: number[] = [1, 2, 3, 4];
function read5(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap5(): void { const held = list5[0]; list5[0] = list5[1]; list5[1] = held; }
function attack5(): void { const other: any = [4294967296]; list5[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap5(); read5(list5); }
try { attack5(); swap5(); console.log('4294967296 fromAny', read5(list5), JSON.stringify(list5)); } catch (e) { console.log('4294967296 fromAny threw', (e as Error).constructor.name); }
const list6: number[] = [1, 2, 3, 4];
function read6(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap6(): void { const held = list6[0]; list6[0] = list6[1]; list6[1] = held; }
function attack6(): void { const other: any = { 0: 4294967296 }; list6[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap6(); read6(list6); }
try { attack6(); swap6(); console.log('4294967296 fromAnyObject', read6(list6), JSON.stringify(list6)); } catch (e) { console.log('4294967296 fromAnyObject threw', (e as Error).constructor.name); }
const list7: number[] = [1, 2, 3, 4];
function read7(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap7(): void { const held = list7[0]; list7[0] = list7[1]; list7[1] = held; }
function attack7(): void { (function (..._: number[]) { list7[0] = arguments[0]; })(4294967296); }
for (let turn = 0; turn < 4; turn++) { swap7(); read7(list7); }
try { attack7(); swap7(); console.log('4294967296 fromArguments', read7(list7), JSON.stringify(list7)); } catch (e) { console.log('4294967296 fromArguments threw', (e as Error).constructor.name); }
const list8: number[] = [1, 2, 3, 4];
function read8(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap8(): void { const held = list8[0]; list8[0] = list8[1]; list8[1] = held; }
function attack8(): void { ((...rest: number[]) => { list8[0] = rest[0]; })(4294967296); }
for (let turn = 0; turn < 4; turn++) { swap8(); read8(list8); }
try { attack8(); swap8(); console.log('4294967296 fromRest', read8(list8), JSON.stringify(list8)); } catch (e) { console.log('4294967296 fromRest threw', (e as Error).constructor.name); }
const list9: number[] = [1, 2, 3, 4];
function read9(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap9(): void { const held = list9[0]; list9[0] = list9[1]; list9[1] = held; }
function attack9(): void { const other: number[] = JSON.parse('[1e10]'); list9[0] = other[0]; list9[1] = 4294967296; }
for (let turn = 0; turn < 4; turn++) { swap9(); read9(list9); }
try { attack9(); swap9(); console.log('4294967296 fromParsed', read9(list9), JSON.stringify(list9)); } catch (e) { console.log('4294967296 fromParsed threw', (e as Error).constructor.name); }
const list10: number[] = [1, 2, 3, 4];
function read10(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap10(): void { const held = list10[0]; list10[0] = list10[1]; list10[1] = held; }
function attack10(): void { const other = [1].map(() => 4294967296); list10[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap10(); read10(list10); }
try { attack10(); swap10(); console.log('4294967296 fromMapped', read10(list10), JSON.stringify(list10)); } catch (e) { console.log('4294967296 fromMapped threw', (e as Error).constructor.name); }
const list11: number[] = [1, 2, 3, 4];
function read11(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap11(): void { const held = list11[0]; list11[0] = list11[1]; list11[1] = held; }
function attack11(): void { const other = [1, 2]; other.fill(4294967296); list11[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap11(); read11(list11); }
try { attack11(); swap11(); console.log('4294967296 fromFilled', read11(list11), JSON.stringify(list11)); } catch (e) { console.log('4294967296 fromFilled threw', (e as Error).constructor.name); }
const list12: number[] = [1, 2, 3, 4];
function read12(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap12(): void { const held = list12[0]; list12[0] = list12[1]; list12[1] = held; }
function attack12(): void { const other = [1, 2]; Object.assign(other, [4294967296]); list12[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap12(); read12(list12); }
try { attack12(); swap12(); console.log('4294967296 fromAssigned', read12(list12), JSON.stringify(list12)); } catch (e) { console.log('4294967296 fromAssigned threw', (e as Error).constructor.name); }
const list13: number[] = [1, 2, 3, 4];
function read13(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap13(): void { const held = list13[0]; list13[0] = list13[1]; list13[1] = held; }
function attack13(): void { const other = [1, 2]; Object.defineProperty(other, 0, { get() { return 4294967296; } }); list13[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap13(); read13(list13); }
try { attack13(); swap13(); console.log('4294967296 fromGetter', read13(list13), JSON.stringify(list13)); } catch (e) { console.log('4294967296 fromGetter threw', (e as Error).constructor.name); }
const list14: number[] = [1, 2, 3, 4];
function read14(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap14(): void { const held = list14[0]; list14[0] = list14[1]; list14[1] = held; }
function attack14(): void { const other = [1, 2]; Object.setPrototypeOf(other, Object.assign(Object.create(Array.prototype), { 5: 4294967296 })); list14[0] = other[5]; }
for (let turn = 0; turn < 4; turn++) { swap14(); read14(list14); }
try { attack14(); swap14(); console.log('4294967296 fromPrototypeOfList', read14(list14), JSON.stringify(list14)); } catch (e) { console.log('4294967296 fromPrototypeOfList threw', (e as Error).constructor.name); }
const list15: number[] = [1, 2, 3, 4];
function read15(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap15(): void { const held = list15[0]; list15[0] = list15[1]; list15[1] = held; }
function attack15(): void { class Heir extends Array<number> {} (Heir.prototype as any)[5] = 4294967296; const other = new Heir(); other.push(1); list15[0] = other[5]; }
for (let turn = 0; turn < 4; turn++) { swap15(); read15(list15); }
try { attack15(); swap15(); console.log('4294967296 fromHeirPrototype', read15(list15), JSON.stringify(list15)); } catch (e) { console.log('4294967296 fromHeirPrototype threw', (e as Error).constructor.name); }
const list16: number[] = [1, 2, 3, 4];
function read16(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap16(): void { const held = list16[0]; list16[0] = list16[1]; list16[1] = held; }
function attack16(): void { const other = new Proxy([1, 2], { get(t, k) { return k === '0' ? 4294967296 : (t as any)[k]; } }); list16[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap16(); read16(list16); }
try { attack16(); swap16(); console.log('4294967296 fromProxy', read16(list16), JSON.stringify(list16)); } catch (e) { console.log('4294967296 fromProxy threw', (e as Error).constructor.name); }
const list17: number[] = [1, 2, 3, 4];
function read17(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap17(): void { const held = list17[0]; list17[0] = list17[1]; list17[1] = held; }
function attack17(): void { const other = [[4294967296], [1]]; list17[0] = other[0][0]; list17[1] = other[1][0]; }
for (let turn = 0; turn < 4; turn++) { swap17(); read17(list17); }
try { attack17(); swap17(); console.log('4294967296 fromListOfLists', read17(list17), JSON.stringify(list17)); } catch (e) { console.log('4294967296 fromListOfLists threw', (e as Error).constructor.name); }
const list18: number[] = [1, 2, 3, 4];
function read18(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap18(): void { const held = list18[0]; list18[0] = list18[1]; list18[1] = held; }
function attack18(): void { const other: [number, string] = [4294967296, 'x']; list18[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap18(); read18(list18); }
try { attack18(); swap18(); console.log('4294967296 fromTuple', read18(list18), JSON.stringify(list18)); } catch (e) { console.log('4294967296 fromTuple threw', (e as Error).constructor.name); }
const list19: number[] = [1, 2, 3, 4];
function read19(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap19(): void { const held = list19[0]; list19[0] = list19[1]; list19[1] = held; }
function attack19(): void { const other = turns > 0 ? [1, 2] : [4294967296]; list19[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap19(); read19(list19); }
try { attack19(); swap19(); console.log('4294967296 fromUnionOfLists', read19(list19), JSON.stringify(list19)); } catch (e) { console.log('4294967296 fromUnionOfLists threw', (e as Error).constructor.name); }
const list20: number[] = [1, 2, 3, 4];
function read20(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap20(): void { const held = list20[0]; list20[0] = list20[1]; list20[1] = held; }
function attack20(): void { const other: number[] | Float64Array = turns > 0 ? [1, 2] : new Float64Array([4294967296]); list20[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap20(); read20(list20); }
try { attack20(); swap20(); console.log('4294967296 fromListOrBytes', read20(list20), JSON.stringify(list20)); } catch (e) { console.log('4294967296 fromListOrBytes threw', (e as Error).constructor.name); }
const list21: number[] = [1, 2, 3, 4];
function read21(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap21(): void { const held = list21[0]; list21[0] = list21[1]; list21[1] = held; }
function attack21(): void { const other: any = turns > 0 ? [1] : '7'; list21[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap21(); read21(list21); }
try { attack21(); swap21(); console.log('4294967296 fromString', read21(list21), JSON.stringify(list21)); } catch (e) { console.log('4294967296 fromString threw', (e as Error).constructor.name); }
const list22: number[] = [1, 2, 3, 4];
function read22(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap22(): void { const held = list22[0]; list22[0] = list22[1]; list22[1] = held; }
function attack22(): void { const alias: any = list22; alias[1] = 4294967296; list22[0] = list22[1]; }
for (let turn = 0; turn < 4; turn++) { swap22(); read22(list22); }
try { attack22(); swap22(); console.log('4294967296 fromItselfAfterAny', read22(list22), JSON.stringify(list22)); } catch (e) { console.log('4294967296 fromItselfAfterAny threw', (e as Error).constructor.name); }
const list23: number[] = [1, 2, 3, 4];
function read23(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap23(): void { const held = list23[0]; list23[0] = list23[1]; list23[1] = held; }
function attack23(): void { list23.push(4294967296); list23[0] = list23[list23.length - 1]; }
for (let turn = 0; turn < 4; turn++) { swap23(); read23(list23); }
try { attack23(); swap23(); console.log('4294967296 fromItselfAfterPush', read23(list23), JSON.stringify(list23)); } catch (e) { console.log('4294967296 fromItselfAfterPush threw', (e as Error).constructor.name); }
const list24: number[] = [1, 2, 3, 4];
function read24(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap24(): void { const held = list24[0]; list24[0] = list24[1]; list24[1] = held; }
function attack24(): void { list24.fill(4294967296, 1, 2); list24[0] = list24[1]; }
for (let turn = 0; turn < 4; turn++) { swap24(); read24(list24); }
try { attack24(); swap24(); console.log('4294967296 fromItselfAfterFill', read24(list24), JSON.stringify(list24)); } catch (e) { console.log('4294967296 fromItselfAfterFill threw', (e as Error).constructor.name); }
const list25: number[] = [1, 2, 3, 4];
function read25(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap25(): void { const held = list25[0]; list25[0] = list25[1]; list25[1] = held; }
function attack25(): void { const a = [4294967296]; const b = [1]; const c = [2]; b[0] = a[0]; c[0] = b[0]; list25[0] = c[0]; }
for (let turn = 0; turn < 4; turn++) { swap25(); read25(list25); }
try { attack25(); swap25(); console.log('4294967296 chainOfThree', read25(list25), JSON.stringify(list25)); } catch (e) { console.log('4294967296 chainOfThree threw', (e as Error).constructor.name); }
const list26: number[] = [1, 2, 3, 4];
function read26(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap26(): void { const held = list26[0]; list26[0] = list26[1]; list26[1] = held; }
function attack26(): void { const a = [1]; a[0] = list26[0]; list26[1] = a[0]; a[0] = 4294967296; list26[2] = a[0]; }
for (let turn = 0; turn < 4; turn++) { swap26(); read26(list26); }
try { attack26(); swap26(); console.log('4294967296 ringOfTwo', read26(list26), JSON.stringify(list26)); } catch (e) { console.log('4294967296 ringOfTwo threw', (e as Error).constructor.name); }
const list27: number[] = [1, 2, 3, 4];
function read27(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap27(): void { const held = list27[0]; list27[0] = list27[1]; list27[1] = held; }
function attack27(): void { const other = [4294967296, 1]; [list27[0], other[1]] = [other[0], list27[1]]; }
for (let turn = 0; turn < 4; turn++) { swap27(); read27(list27); }
try { attack27(); swap27(); console.log('4294967296 swapByPattern', read27(list27), JSON.stringify(list27)); } catch (e) { console.log('4294967296 swapByPattern threw', (e as Error).constructor.name); }
const list28: number[] = [1, 2, 3, 4];
function read28(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap28(): void { const held = list28[0]; list28[0] = list28[1]; list28[1] = held; }
function attack28(): void { const other = [4294967296]; list28.push(other[0]); }
for (let turn = 0; turn < 4; turn++) { swap28(); read28(list28); }
try { attack28(); swap28(); console.log('4294967296 pushOfARead', read28(list28), JSON.stringify(list28)); } catch (e) { console.log('4294967296 pushOfARead threw', (e as Error).constructor.name); }
const list29: number[] = [1, 2, 3, 4];
function read29(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap29(): void { const held = list29[0]; list29[0] = list29[1]; list29[1] = held; }
function attack29(): void { const other = [4294967296]; const made = [other[0], list29[0]]; list29[1] = made[0]; }
for (let turn = 0; turn < 4; turn++) { swap29(); read29(list29); }
try { attack29(); swap29(); console.log('4294967296 literalOfReads', read29(list29), JSON.stringify(list29)); } catch (e) { console.log('4294967296 literalOfReads threw', (e as Error).constructor.name); }
const list30: number[] = [1, 2, 3, 4];
function read30(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap30(): void { const held = list30[0]; list30[0] = list30[1]; list30[1] = held; }
function attack30(): void { list30[0] = list30[1] * 1073741824 * 4; list30[2] = list30[0]; }
for (let turn = 0; turn < 4; turn++) { swap30(); read30(list30); }
try { attack30(); swap30(); console.log('4294967296 readThenArithmetic', read30(list30), JSON.stringify(list30)); } catch (e) { console.log('4294967296 readThenArithmetic threw', (e as Error).constructor.name); }
const list31: number[] = [1, 2, 3, 4];
function read31(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap31(): void { const held = list31[0]; list31[0] = list31[1]; list31[1] = held; }
function attack31(): void { const other = [4294967296]; list31[0] = first(other); }
for (let turn = 0; turn < 4; turn++) { swap31(); read31(list31); }
try { attack31(); swap31(); console.log('4294967296 readThroughAFunction', read31(list31), JSON.stringify(list31)); } catch (e) { console.log('4294967296 readThroughAFunction threw', (e as Error).constructor.name); }
const list32: number[] = [1, 2, 3, 4];
function read32(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap32(): void { const held = list32[0]; list32[0] = list32[1]; list32[1] = held; }
function attack32(): void { const other = [4294967296]; storeInto(list32, other[0]); }
for (let turn = 0; turn < 4; turn++) { swap32(); read32(list32); }
try { attack32(); swap32(); console.log('4294967296 storeThroughAFunction', read32(list32), JSON.stringify(list32)); } catch (e) { console.log('4294967296 storeThroughAFunction threw', (e as Error).constructor.name); }
const list33: number[] = [1, 2, 3, 4];
function read33(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap33(): void { const held = list33[0]; list33[0] = list33[1]; list33[1] = held; }
function attack33(): void { const other: number[] = []; list33[0] = other[0] ?? 4294967296; }
for (let turn = 0; turn < 4; turn++) { swap33(); read33(list33); }
try { attack33(); swap33(); console.log('4294967296 readOrDefault', read33(list33), JSON.stringify(list33)); } catch (e) { console.log('4294967296 readOrDefault threw', (e as Error).constructor.name); }
const list34: number[] = [1, 2, 3, 4];
function read34(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap34(): void { const held = list34[0]; list34[0] = list34[1]; list34[1] = held; }
function attack34(): void { const other = [1]; list34[0] = turns > 0 ? other[0] : 4294967296; }
for (let turn = 0; turn < 4; turn++) { swap34(); read34(list34); }
try { attack34(); swap34(); console.log('4294967296 readConditional', read34(list34), JSON.stringify(list34)); } catch (e) { console.log('4294967296 readConditional threw', (e as Error).constructor.name); }
const list35: number[] = [1, 2, 3, 4];
function read35(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap35(): void { const held = list35[0]; list35[0] = list35[1]; list35[1] = held; }
function attack35(): void { list35[0] = 2147483647; list35[0]++; list35[1] = list35[0]; }
for (let turn = 0; turn < 4; turn++) { swap35(); read35(list35); }
try { attack35(); swap35(); console.log('4294967296 readIncremented', read35(list35), JSON.stringify(list35)); } catch (e) { console.log('4294967296 readIncremented threw', (e as Error).constructor.name); }
const list36: number[] = [1, 2, 3, 4];
function read36(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap36(): void { const held = list36[0]; list36[0] = list36[1]; list36[1] = held; }
function attack36(): void { list36[0] = 2147483647; list36[0] += list36[0]; list36[1] = list36[0]; }
for (let turn = 0; turn < 4; turn++) { swap36(); read36(list36); }
try { attack36(); swap36(); console.log('4294967296 readCompound', read36(list36), JSON.stringify(list36)); } catch (e) { console.log('4294967296 readCompound threw', (e as Error).constructor.name); }
const list37: number[] = [1, 2, 3, 4];
function read37(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap37(): void { const held = list37[0]; list37[0] = list37[1]; list37[1] = held; }
function attack37(): void { list37[0] = list37[99]; list37[1] = list37[-1 as number]; }
for (let turn = 0; turn < 4; turn++) { swap37(); read37(list37); }
try { attack37(); swap37(); console.log('4294967296 pastTheEnd', read37(list37), JSON.stringify(list37)); } catch (e) { console.log('4294967296 pastTheEnd threw', (e as Error).constructor.name); }
const list38: number[] = [1, 2, 3, 4];
function read38(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap38(): void { const held = list38[0]; list38[0] = list38[1]; list38[1] = held; }
function attack38(): void { const other = [1, , 3] as number[]; list38[0] = other[1]; }
for (let turn = 0; turn < 4; turn++) { swap38(); read38(list38); }
try { attack38(); swap38(); console.log('4294967296 fromHole', read38(list38), JSON.stringify(list38)); } catch (e) { console.log('4294967296 fromHole threw', (e as Error).constructor.name); }
const list39: number[] = [1, 2, 3, 4];
function read39(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap39(): void { const held = list39[0]; list39[0] = list39[1]; list39[1] = held; }
function attack39(): void { const other = [4294967296].slice(); list39[0] = other[0]; const again = list39.slice(); list39[1] = again[0]; }
for (let turn = 0; turn < 4; turn++) { swap39(); read39(list39); }
try { attack39(); swap39(); console.log('4294967296 copyThenStoreBack', read39(list39), JSON.stringify(list39)); } catch (e) { console.log('4294967296 copyThenStoreBack threw', (e as Error).constructor.name); }
const list40: number[] = [1, 2, 3, 4];
function read40(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap40(): void { const held = list40[0]; list40[0] = list40[1]; list40[1] = held; }
function attack40(): void { const other = new Float64Array([7.25, 7.25]); list40[0] = other[0]; list40[1] = other[1]!; }
for (let turn = 0; turn < 4; turn++) { swap40(); read40(list40); }
try { attack40(); swap40(); console.log('7.25 fromBytes', read40(list40), JSON.stringify(list40)); } catch (e) { console.log('7.25 fromBytes threw', (e as Error).constructor.name); }
const list41: number[] = [1, 2, 3, 4];
function read41(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap41(): void { const held = list41[0]; list41[0] = list41[1]; list41[1] = held; }
function attack41(): void { const other = new Uint32Array([4294967295]); list41[0] = other[0]; list41[1] = 7.25; }
for (let turn = 0; turn < 4; turn++) { swap41(); read41(list41); }
try { attack41(); swap41(); console.log('7.25 fromBigInts32', read41(list41), JSON.stringify(list41)); } catch (e) { console.log('7.25 fromBigInts32 threw', (e as Error).constructor.name); }
const list42: number[] = [1, 2, 3, 4];
function read42(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap42(): void { const held = list42[0]; list42[0] = list42[1]; list42[1] = held; }
function attack42(): void { const other: ArrayLike<number> = { length: 1, 0: 7.25 }; list42[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap42(); read42(list42); }
try { attack42(); swap42(); console.log('7.25 fromArrayLike', read42(list42), JSON.stringify(list42)); } catch (e) { console.log('7.25 fromArrayLike threw', (e as Error).constructor.name); }
const list43: number[] = [1, 2, 3, 4];
function read43(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap43(): void { const held = list43[0]; list43[0] = list43[1]; list43[1] = held; }
function attack43(): void { const other: Record<number, number> = { 0: 7.25 }; list43[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap43(); read43(list43); }
try { attack43(); swap43(); console.log('7.25 fromRecord', read43(list43), JSON.stringify(list43)); } catch (e) { console.log('7.25 fromRecord threw', (e as Error).constructor.name); }
const list44: number[] = [1, 2, 3, 4];
function read44(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap44(): void { const held = list44[0]; list44[0] = list44[1]; list44[1] = held; }
function attack44(): void { const other: any = [7.25]; list44[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap44(); read44(list44); }
try { attack44(); swap44(); console.log('7.25 fromAny', read44(list44), JSON.stringify(list44)); } catch (e) { console.log('7.25 fromAny threw', (e as Error).constructor.name); }
const list45: number[] = [1, 2, 3, 4];
function read45(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap45(): void { const held = list45[0]; list45[0] = list45[1]; list45[1] = held; }
function attack45(): void { const other: any = { 0: 7.25 }; list45[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap45(); read45(list45); }
try { attack45(); swap45(); console.log('7.25 fromAnyObject', read45(list45), JSON.stringify(list45)); } catch (e) { console.log('7.25 fromAnyObject threw', (e as Error).constructor.name); }
const list46: number[] = [1, 2, 3, 4];
function read46(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap46(): void { const held = list46[0]; list46[0] = list46[1]; list46[1] = held; }
function attack46(): void { (function (..._: number[]) { list46[0] = arguments[0]; })(7.25); }
for (let turn = 0; turn < 4; turn++) { swap46(); read46(list46); }
try { attack46(); swap46(); console.log('7.25 fromArguments', read46(list46), JSON.stringify(list46)); } catch (e) { console.log('7.25 fromArguments threw', (e as Error).constructor.name); }
const list47: number[] = [1, 2, 3, 4];
function read47(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap47(): void { const held = list47[0]; list47[0] = list47[1]; list47[1] = held; }
function attack47(): void { ((...rest: number[]) => { list47[0] = rest[0]; })(7.25); }
for (let turn = 0; turn < 4; turn++) { swap47(); read47(list47); }
try { attack47(); swap47(); console.log('7.25 fromRest', read47(list47), JSON.stringify(list47)); } catch (e) { console.log('7.25 fromRest threw', (e as Error).constructor.name); }
const list48: number[] = [1, 2, 3, 4];
function read48(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap48(): void { const held = list48[0]; list48[0] = list48[1]; list48[1] = held; }
function attack48(): void { const other: number[] = JSON.parse('[1e10]'); list48[0] = other[0]; list48[1] = 7.25; }
for (let turn = 0; turn < 4; turn++) { swap48(); read48(list48); }
try { attack48(); swap48(); console.log('7.25 fromParsed', read48(list48), JSON.stringify(list48)); } catch (e) { console.log('7.25 fromParsed threw', (e as Error).constructor.name); }
const list49: number[] = [1, 2, 3, 4];
function read49(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap49(): void { const held = list49[0]; list49[0] = list49[1]; list49[1] = held; }
function attack49(): void { const other = [1].map(() => 7.25); list49[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap49(); read49(list49); }
try { attack49(); swap49(); console.log('7.25 fromMapped', read49(list49), JSON.stringify(list49)); } catch (e) { console.log('7.25 fromMapped threw', (e as Error).constructor.name); }
const list50: number[] = [1, 2, 3, 4];
function read50(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap50(): void { const held = list50[0]; list50[0] = list50[1]; list50[1] = held; }
function attack50(): void { const other = [1, 2]; other.fill(7.25); list50[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap50(); read50(list50); }
try { attack50(); swap50(); console.log('7.25 fromFilled', read50(list50), JSON.stringify(list50)); } catch (e) { console.log('7.25 fromFilled threw', (e as Error).constructor.name); }
const list51: number[] = [1, 2, 3, 4];
function read51(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap51(): void { const held = list51[0]; list51[0] = list51[1]; list51[1] = held; }
function attack51(): void { const other = [1, 2]; Object.assign(other, [7.25]); list51[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap51(); read51(list51); }
try { attack51(); swap51(); console.log('7.25 fromAssigned', read51(list51), JSON.stringify(list51)); } catch (e) { console.log('7.25 fromAssigned threw', (e as Error).constructor.name); }
const list52: number[] = [1, 2, 3, 4];
function read52(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap52(): void { const held = list52[0]; list52[0] = list52[1]; list52[1] = held; }
function attack52(): void { const other = [1, 2]; Object.defineProperty(other, 0, { get() { return 7.25; } }); list52[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap52(); read52(list52); }
try { attack52(); swap52(); console.log('7.25 fromGetter', read52(list52), JSON.stringify(list52)); } catch (e) { console.log('7.25 fromGetter threw', (e as Error).constructor.name); }
const list53: number[] = [1, 2, 3, 4];
function read53(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap53(): void { const held = list53[0]; list53[0] = list53[1]; list53[1] = held; }
function attack53(): void { const other = [1, 2]; Object.setPrototypeOf(other, Object.assign(Object.create(Array.prototype), { 5: 7.25 })); list53[0] = other[5]; }
for (let turn = 0; turn < 4; turn++) { swap53(); read53(list53); }
try { attack53(); swap53(); console.log('7.25 fromPrototypeOfList', read53(list53), JSON.stringify(list53)); } catch (e) { console.log('7.25 fromPrototypeOfList threw', (e as Error).constructor.name); }
const list54: number[] = [1, 2, 3, 4];
function read54(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap54(): void { const held = list54[0]; list54[0] = list54[1]; list54[1] = held; }
function attack54(): void { class Heir extends Array<number> {} (Heir.prototype as any)[5] = 7.25; const other = new Heir(); other.push(1); list54[0] = other[5]; }
for (let turn = 0; turn < 4; turn++) { swap54(); read54(list54); }
try { attack54(); swap54(); console.log('7.25 fromHeirPrototype', read54(list54), JSON.stringify(list54)); } catch (e) { console.log('7.25 fromHeirPrototype threw', (e as Error).constructor.name); }
const list55: number[] = [1, 2, 3, 4];
function read55(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap55(): void { const held = list55[0]; list55[0] = list55[1]; list55[1] = held; }
function attack55(): void { const other = new Proxy([1, 2], { get(t, k) { return k === '0' ? 7.25 : (t as any)[k]; } }); list55[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap55(); read55(list55); }
try { attack55(); swap55(); console.log('7.25 fromProxy', read55(list55), JSON.stringify(list55)); } catch (e) { console.log('7.25 fromProxy threw', (e as Error).constructor.name); }
const list56: number[] = [1, 2, 3, 4];
function read56(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap56(): void { const held = list56[0]; list56[0] = list56[1]; list56[1] = held; }
function attack56(): void { const other = [[7.25], [1]]; list56[0] = other[0][0]; list56[1] = other[1][0]; }
for (let turn = 0; turn < 4; turn++) { swap56(); read56(list56); }
try { attack56(); swap56(); console.log('7.25 fromListOfLists', read56(list56), JSON.stringify(list56)); } catch (e) { console.log('7.25 fromListOfLists threw', (e as Error).constructor.name); }
const list57: number[] = [1, 2, 3, 4];
function read57(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap57(): void { const held = list57[0]; list57[0] = list57[1]; list57[1] = held; }
function attack57(): void { const other: [number, string] = [7.25, 'x']; list57[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap57(); read57(list57); }
try { attack57(); swap57(); console.log('7.25 fromTuple', read57(list57), JSON.stringify(list57)); } catch (e) { console.log('7.25 fromTuple threw', (e as Error).constructor.name); }
const list58: number[] = [1, 2, 3, 4];
function read58(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap58(): void { const held = list58[0]; list58[0] = list58[1]; list58[1] = held; }
function attack58(): void { const other = turns > 0 ? [1, 2] : [7.25]; list58[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap58(); read58(list58); }
try { attack58(); swap58(); console.log('7.25 fromUnionOfLists', read58(list58), JSON.stringify(list58)); } catch (e) { console.log('7.25 fromUnionOfLists threw', (e as Error).constructor.name); }
const list59: number[] = [1, 2, 3, 4];
function read59(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap59(): void { const held = list59[0]; list59[0] = list59[1]; list59[1] = held; }
function attack59(): void { const other: number[] | Float64Array = turns > 0 ? [1, 2] : new Float64Array([7.25]); list59[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap59(); read59(list59); }
try { attack59(); swap59(); console.log('7.25 fromListOrBytes', read59(list59), JSON.stringify(list59)); } catch (e) { console.log('7.25 fromListOrBytes threw', (e as Error).constructor.name); }
const list60: number[] = [1, 2, 3, 4];
function read60(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap60(): void { const held = list60[0]; list60[0] = list60[1]; list60[1] = held; }
function attack60(): void { const other: any = turns > 0 ? [1] : '7'; list60[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap60(); read60(list60); }
try { attack60(); swap60(); console.log('7.25 fromString', read60(list60), JSON.stringify(list60)); } catch (e) { console.log('7.25 fromString threw', (e as Error).constructor.name); }
const list61: number[] = [1, 2, 3, 4];
function read61(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap61(): void { const held = list61[0]; list61[0] = list61[1]; list61[1] = held; }
function attack61(): void { const alias: any = list61; alias[1] = 7.25; list61[0] = list61[1]; }
for (let turn = 0; turn < 4; turn++) { swap61(); read61(list61); }
try { attack61(); swap61(); console.log('7.25 fromItselfAfterAny', read61(list61), JSON.stringify(list61)); } catch (e) { console.log('7.25 fromItselfAfterAny threw', (e as Error).constructor.name); }
const list62: number[] = [1, 2, 3, 4];
function read62(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap62(): void { const held = list62[0]; list62[0] = list62[1]; list62[1] = held; }
function attack62(): void { list62.push(7.25); list62[0] = list62[list62.length - 1]; }
for (let turn = 0; turn < 4; turn++) { swap62(); read62(list62); }
try { attack62(); swap62(); console.log('7.25 fromItselfAfterPush', read62(list62), JSON.stringify(list62)); } catch (e) { console.log('7.25 fromItselfAfterPush threw', (e as Error).constructor.name); }
const list63: number[] = [1, 2, 3, 4];
function read63(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap63(): void { const held = list63[0]; list63[0] = list63[1]; list63[1] = held; }
function attack63(): void { list63.fill(7.25, 1, 2); list63[0] = list63[1]; }
for (let turn = 0; turn < 4; turn++) { swap63(); read63(list63); }
try { attack63(); swap63(); console.log('7.25 fromItselfAfterFill', read63(list63), JSON.stringify(list63)); } catch (e) { console.log('7.25 fromItselfAfterFill threw', (e as Error).constructor.name); }
const list64: number[] = [1, 2, 3, 4];
function read64(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap64(): void { const held = list64[0]; list64[0] = list64[1]; list64[1] = held; }
function attack64(): void { const a = [7.25]; const b = [1]; const c = [2]; b[0] = a[0]; c[0] = b[0]; list64[0] = c[0]; }
for (let turn = 0; turn < 4; turn++) { swap64(); read64(list64); }
try { attack64(); swap64(); console.log('7.25 chainOfThree', read64(list64), JSON.stringify(list64)); } catch (e) { console.log('7.25 chainOfThree threw', (e as Error).constructor.name); }
const list65: number[] = [1, 2, 3, 4];
function read65(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap65(): void { const held = list65[0]; list65[0] = list65[1]; list65[1] = held; }
function attack65(): void { const a = [1]; a[0] = list65[0]; list65[1] = a[0]; a[0] = 7.25; list65[2] = a[0]; }
for (let turn = 0; turn < 4; turn++) { swap65(); read65(list65); }
try { attack65(); swap65(); console.log('7.25 ringOfTwo', read65(list65), JSON.stringify(list65)); } catch (e) { console.log('7.25 ringOfTwo threw', (e as Error).constructor.name); }
const list66: number[] = [1, 2, 3, 4];
function read66(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap66(): void { const held = list66[0]; list66[0] = list66[1]; list66[1] = held; }
function attack66(): void { const other = [7.25, 1]; [list66[0], other[1]] = [other[0], list66[1]]; }
for (let turn = 0; turn < 4; turn++) { swap66(); read66(list66); }
try { attack66(); swap66(); console.log('7.25 swapByPattern', read66(list66), JSON.stringify(list66)); } catch (e) { console.log('7.25 swapByPattern threw', (e as Error).constructor.name); }
const list67: number[] = [1, 2, 3, 4];
function read67(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap67(): void { const held = list67[0]; list67[0] = list67[1]; list67[1] = held; }
function attack67(): void { const other = [7.25]; list67.push(other[0]); }
for (let turn = 0; turn < 4; turn++) { swap67(); read67(list67); }
try { attack67(); swap67(); console.log('7.25 pushOfARead', read67(list67), JSON.stringify(list67)); } catch (e) { console.log('7.25 pushOfARead threw', (e as Error).constructor.name); }
const list68: number[] = [1, 2, 3, 4];
function read68(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap68(): void { const held = list68[0]; list68[0] = list68[1]; list68[1] = held; }
function attack68(): void { const other = [7.25]; const made = [other[0], list68[0]]; list68[1] = made[0]; }
for (let turn = 0; turn < 4; turn++) { swap68(); read68(list68); }
try { attack68(); swap68(); console.log('7.25 literalOfReads', read68(list68), JSON.stringify(list68)); } catch (e) { console.log('7.25 literalOfReads threw', (e as Error).constructor.name); }
const list69: number[] = [1, 2, 3, 4];
function read69(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap69(): void { const held = list69[0]; list69[0] = list69[1]; list69[1] = held; }
function attack69(): void { list69[0] = list69[1] * 1073741824 * 4; list69[2] = list69[0]; }
for (let turn = 0; turn < 4; turn++) { swap69(); read69(list69); }
try { attack69(); swap69(); console.log('7.25 readThenArithmetic', read69(list69), JSON.stringify(list69)); } catch (e) { console.log('7.25 readThenArithmetic threw', (e as Error).constructor.name); }
const list70: number[] = [1, 2, 3, 4];
function read70(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap70(): void { const held = list70[0]; list70[0] = list70[1]; list70[1] = held; }
function attack70(): void { const other = [7.25]; list70[0] = first(other); }
for (let turn = 0; turn < 4; turn++) { swap70(); read70(list70); }
try { attack70(); swap70(); console.log('7.25 readThroughAFunction', read70(list70), JSON.stringify(list70)); } catch (e) { console.log('7.25 readThroughAFunction threw', (e as Error).constructor.name); }
const list71: number[] = [1, 2, 3, 4];
function read71(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap71(): void { const held = list71[0]; list71[0] = list71[1]; list71[1] = held; }
function attack71(): void { const other = [7.25]; storeInto(list71, other[0]); }
for (let turn = 0; turn < 4; turn++) { swap71(); read71(list71); }
try { attack71(); swap71(); console.log('7.25 storeThroughAFunction', read71(list71), JSON.stringify(list71)); } catch (e) { console.log('7.25 storeThroughAFunction threw', (e as Error).constructor.name); }
const list72: number[] = [1, 2, 3, 4];
function read72(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap72(): void { const held = list72[0]; list72[0] = list72[1]; list72[1] = held; }
function attack72(): void { const other: number[] = []; list72[0] = other[0] ?? 7.25; }
for (let turn = 0; turn < 4; turn++) { swap72(); read72(list72); }
try { attack72(); swap72(); console.log('7.25 readOrDefault', read72(list72), JSON.stringify(list72)); } catch (e) { console.log('7.25 readOrDefault threw', (e as Error).constructor.name); }
const list73: number[] = [1, 2, 3, 4];
function read73(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap73(): void { const held = list73[0]; list73[0] = list73[1]; list73[1] = held; }
function attack73(): void { const other = [1]; list73[0] = turns > 0 ? other[0] : 7.25; }
for (let turn = 0; turn < 4; turn++) { swap73(); read73(list73); }
try { attack73(); swap73(); console.log('7.25 readConditional', read73(list73), JSON.stringify(list73)); } catch (e) { console.log('7.25 readConditional threw', (e as Error).constructor.name); }
const list74: number[] = [1, 2, 3, 4];
function read74(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap74(): void { const held = list74[0]; list74[0] = list74[1]; list74[1] = held; }
function attack74(): void { list74[0] = 2147483647; list74[0]++; list74[1] = list74[0]; }
for (let turn = 0; turn < 4; turn++) { swap74(); read74(list74); }
try { attack74(); swap74(); console.log('7.25 readIncremented', read74(list74), JSON.stringify(list74)); } catch (e) { console.log('7.25 readIncremented threw', (e as Error).constructor.name); }
const list75: number[] = [1, 2, 3, 4];
function read75(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap75(): void { const held = list75[0]; list75[0] = list75[1]; list75[1] = held; }
function attack75(): void { list75[0] = 2147483647; list75[0] += list75[0]; list75[1] = list75[0]; }
for (let turn = 0; turn < 4; turn++) { swap75(); read75(list75); }
try { attack75(); swap75(); console.log('7.25 readCompound', read75(list75), JSON.stringify(list75)); } catch (e) { console.log('7.25 readCompound threw', (e as Error).constructor.name); }
const list76: number[] = [1, 2, 3, 4];
function read76(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap76(): void { const held = list76[0]; list76[0] = list76[1]; list76[1] = held; }
function attack76(): void { list76[0] = list76[99]; list76[1] = list76[-1 as number]; }
for (let turn = 0; turn < 4; turn++) { swap76(); read76(list76); }
try { attack76(); swap76(); console.log('7.25 pastTheEnd', read76(list76), JSON.stringify(list76)); } catch (e) { console.log('7.25 pastTheEnd threw', (e as Error).constructor.name); }
const list77: number[] = [1, 2, 3, 4];
function read77(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap77(): void { const held = list77[0]; list77[0] = list77[1]; list77[1] = held; }
function attack77(): void { const other = [1, , 3] as number[]; list77[0] = other[1]; }
for (let turn = 0; turn < 4; turn++) { swap77(); read77(list77); }
try { attack77(); swap77(); console.log('7.25 fromHole', read77(list77), JSON.stringify(list77)); } catch (e) { console.log('7.25 fromHole threw', (e as Error).constructor.name); }
const list78: number[] = [1, 2, 3, 4];
function read78(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap78(): void { const held = list78[0]; list78[0] = list78[1]; list78[1] = held; }
function attack78(): void { const other = [7.25].slice(); list78[0] = other[0]; const again = list78.slice(); list78[1] = again[0]; }
for (let turn = 0; turn < 4; turn++) { swap78(); read78(list78); }
try { attack78(); swap78(); console.log('7.25 copyThenStoreBack', read78(list78), JSON.stringify(list78)); } catch (e) { console.log('7.25 copyThenStoreBack threw', (e as Error).constructor.name); }
const list79: number[] = [1, 2, 3, 4];
function read79(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap79(): void { const held = list79[0]; list79[0] = list79[1]; list79[1] = held; }
function attack79(): void { const other = new Float64Array([NaN, NaN]); list79[0] = other[0]; list79[1] = other[1]!; }
for (let turn = 0; turn < 4; turn++) { swap79(); read79(list79); }
try { attack79(); swap79(); console.log('NaN fromBytes', read79(list79), JSON.stringify(list79)); } catch (e) { console.log('NaN fromBytes threw', (e as Error).constructor.name); }
const list80: number[] = [1, 2, 3, 4];
function read80(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap80(): void { const held = list80[0]; list80[0] = list80[1]; list80[1] = held; }
function attack80(): void { const other = new Uint32Array([4294967295]); list80[0] = other[0]; list80[1] = NaN; }
for (let turn = 0; turn < 4; turn++) { swap80(); read80(list80); }
try { attack80(); swap80(); console.log('NaN fromBigInts32', read80(list80), JSON.stringify(list80)); } catch (e) { console.log('NaN fromBigInts32 threw', (e as Error).constructor.name); }
const list81: number[] = [1, 2, 3, 4];
function read81(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap81(): void { const held = list81[0]; list81[0] = list81[1]; list81[1] = held; }
function attack81(): void { const other: ArrayLike<number> = { length: 1, 0: NaN }; list81[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap81(); read81(list81); }
try { attack81(); swap81(); console.log('NaN fromArrayLike', read81(list81), JSON.stringify(list81)); } catch (e) { console.log('NaN fromArrayLike threw', (e as Error).constructor.name); }
const list82: number[] = [1, 2, 3, 4];
function read82(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap82(): void { const held = list82[0]; list82[0] = list82[1]; list82[1] = held; }
function attack82(): void { const other: Record<number, number> = { 0: NaN }; list82[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap82(); read82(list82); }
try { attack82(); swap82(); console.log('NaN fromRecord', read82(list82), JSON.stringify(list82)); } catch (e) { console.log('NaN fromRecord threw', (e as Error).constructor.name); }
const list83: number[] = [1, 2, 3, 4];
function read83(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap83(): void { const held = list83[0]; list83[0] = list83[1]; list83[1] = held; }
function attack83(): void { const other: any = [NaN]; list83[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap83(); read83(list83); }
try { attack83(); swap83(); console.log('NaN fromAny', read83(list83), JSON.stringify(list83)); } catch (e) { console.log('NaN fromAny threw', (e as Error).constructor.name); }
const list84: number[] = [1, 2, 3, 4];
function read84(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap84(): void { const held = list84[0]; list84[0] = list84[1]; list84[1] = held; }
function attack84(): void { const other: any = { 0: NaN }; list84[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap84(); read84(list84); }
try { attack84(); swap84(); console.log('NaN fromAnyObject', read84(list84), JSON.stringify(list84)); } catch (e) { console.log('NaN fromAnyObject threw', (e as Error).constructor.name); }
const list85: number[] = [1, 2, 3, 4];
function read85(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap85(): void { const held = list85[0]; list85[0] = list85[1]; list85[1] = held; }
function attack85(): void { (function (..._: number[]) { list85[0] = arguments[0]; })(NaN); }
for (let turn = 0; turn < 4; turn++) { swap85(); read85(list85); }
try { attack85(); swap85(); console.log('NaN fromArguments', read85(list85), JSON.stringify(list85)); } catch (e) { console.log('NaN fromArguments threw', (e as Error).constructor.name); }
const list86: number[] = [1, 2, 3, 4];
function read86(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap86(): void { const held = list86[0]; list86[0] = list86[1]; list86[1] = held; }
function attack86(): void { ((...rest: number[]) => { list86[0] = rest[0]; })(NaN); }
for (let turn = 0; turn < 4; turn++) { swap86(); read86(list86); }
try { attack86(); swap86(); console.log('NaN fromRest', read86(list86), JSON.stringify(list86)); } catch (e) { console.log('NaN fromRest threw', (e as Error).constructor.name); }
const list87: number[] = [1, 2, 3, 4];
function read87(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap87(): void { const held = list87[0]; list87[0] = list87[1]; list87[1] = held; }
function attack87(): void { const other: number[] = JSON.parse('[1e10]'); list87[0] = other[0]; list87[1] = NaN; }
for (let turn = 0; turn < 4; turn++) { swap87(); read87(list87); }
try { attack87(); swap87(); console.log('NaN fromParsed', read87(list87), JSON.stringify(list87)); } catch (e) { console.log('NaN fromParsed threw', (e as Error).constructor.name); }
const list88: number[] = [1, 2, 3, 4];
function read88(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap88(): void { const held = list88[0]; list88[0] = list88[1]; list88[1] = held; }
function attack88(): void { const other = [1].map(() => NaN); list88[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap88(); read88(list88); }
try { attack88(); swap88(); console.log('NaN fromMapped', read88(list88), JSON.stringify(list88)); } catch (e) { console.log('NaN fromMapped threw', (e as Error).constructor.name); }
const list89: number[] = [1, 2, 3, 4];
function read89(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap89(): void { const held = list89[0]; list89[0] = list89[1]; list89[1] = held; }
function attack89(): void { const other = [1, 2]; other.fill(NaN); list89[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap89(); read89(list89); }
try { attack89(); swap89(); console.log('NaN fromFilled', read89(list89), JSON.stringify(list89)); } catch (e) { console.log('NaN fromFilled threw', (e as Error).constructor.name); }
const list90: number[] = [1, 2, 3, 4];
function read90(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap90(): void { const held = list90[0]; list90[0] = list90[1]; list90[1] = held; }
function attack90(): void { const other = [1, 2]; Object.assign(other, [NaN]); list90[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap90(); read90(list90); }
try { attack90(); swap90(); console.log('NaN fromAssigned', read90(list90), JSON.stringify(list90)); } catch (e) { console.log('NaN fromAssigned threw', (e as Error).constructor.name); }
const list91: number[] = [1, 2, 3, 4];
function read91(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap91(): void { const held = list91[0]; list91[0] = list91[1]; list91[1] = held; }
function attack91(): void { const other = [1, 2]; Object.defineProperty(other, 0, { get() { return NaN; } }); list91[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap91(); read91(list91); }
try { attack91(); swap91(); console.log('NaN fromGetter', read91(list91), JSON.stringify(list91)); } catch (e) { console.log('NaN fromGetter threw', (e as Error).constructor.name); }
const list92: number[] = [1, 2, 3, 4];
function read92(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap92(): void { const held = list92[0]; list92[0] = list92[1]; list92[1] = held; }
function attack92(): void { const other = [1, 2]; Object.setPrototypeOf(other, Object.assign(Object.create(Array.prototype), { 5: NaN })); list92[0] = other[5]; }
for (let turn = 0; turn < 4; turn++) { swap92(); read92(list92); }
try { attack92(); swap92(); console.log('NaN fromPrototypeOfList', read92(list92), JSON.stringify(list92)); } catch (e) { console.log('NaN fromPrototypeOfList threw', (e as Error).constructor.name); }
const list93: number[] = [1, 2, 3, 4];
function read93(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap93(): void { const held = list93[0]; list93[0] = list93[1]; list93[1] = held; }
function attack93(): void { class Heir extends Array<number> {} (Heir.prototype as any)[5] = NaN; const other = new Heir(); other.push(1); list93[0] = other[5]; }
for (let turn = 0; turn < 4; turn++) { swap93(); read93(list93); }
try { attack93(); swap93(); console.log('NaN fromHeirPrototype', read93(list93), JSON.stringify(list93)); } catch (e) { console.log('NaN fromHeirPrototype threw', (e as Error).constructor.name); }
const list94: number[] = [1, 2, 3, 4];
function read94(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap94(): void { const held = list94[0]; list94[0] = list94[1]; list94[1] = held; }
function attack94(): void { const other = new Proxy([1, 2], { get(t, k) { return k === '0' ? NaN : (t as any)[k]; } }); list94[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap94(); read94(list94); }
try { attack94(); swap94(); console.log('NaN fromProxy', read94(list94), JSON.stringify(list94)); } catch (e) { console.log('NaN fromProxy threw', (e as Error).constructor.name); }
const list95: number[] = [1, 2, 3, 4];
function read95(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap95(): void { const held = list95[0]; list95[0] = list95[1]; list95[1] = held; }
function attack95(): void { const other = [[NaN], [1]]; list95[0] = other[0][0]; list95[1] = other[1][0]; }
for (let turn = 0; turn < 4; turn++) { swap95(); read95(list95); }
try { attack95(); swap95(); console.log('NaN fromListOfLists', read95(list95), JSON.stringify(list95)); } catch (e) { console.log('NaN fromListOfLists threw', (e as Error).constructor.name); }
const list96: number[] = [1, 2, 3, 4];
function read96(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap96(): void { const held = list96[0]; list96[0] = list96[1]; list96[1] = held; }
function attack96(): void { const other: [number, string] = [NaN, 'x']; list96[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap96(); read96(list96); }
try { attack96(); swap96(); console.log('NaN fromTuple', read96(list96), JSON.stringify(list96)); } catch (e) { console.log('NaN fromTuple threw', (e as Error).constructor.name); }
const list97: number[] = [1, 2, 3, 4];
function read97(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap97(): void { const held = list97[0]; list97[0] = list97[1]; list97[1] = held; }
function attack97(): void { const other = turns > 0 ? [1, 2] : [NaN]; list97[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap97(); read97(list97); }
try { attack97(); swap97(); console.log('NaN fromUnionOfLists', read97(list97), JSON.stringify(list97)); } catch (e) { console.log('NaN fromUnionOfLists threw', (e as Error).constructor.name); }
const list98: number[] = [1, 2, 3, 4];
function read98(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap98(): void { const held = list98[0]; list98[0] = list98[1]; list98[1] = held; }
function attack98(): void { const other: number[] | Float64Array = turns > 0 ? [1, 2] : new Float64Array([NaN]); list98[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap98(); read98(list98); }
try { attack98(); swap98(); console.log('NaN fromListOrBytes', read98(list98), JSON.stringify(list98)); } catch (e) { console.log('NaN fromListOrBytes threw', (e as Error).constructor.name); }
const list99: number[] = [1, 2, 3, 4];
function read99(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap99(): void { const held = list99[0]; list99[0] = list99[1]; list99[1] = held; }
function attack99(): void { const other: any = turns > 0 ? [1] : '7'; list99[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap99(); read99(list99); }
try { attack99(); swap99(); console.log('NaN fromString', read99(list99), JSON.stringify(list99)); } catch (e) { console.log('NaN fromString threw', (e as Error).constructor.name); }
const list100: number[] = [1, 2, 3, 4];
function read100(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap100(): void { const held = list100[0]; list100[0] = list100[1]; list100[1] = held; }
function attack100(): void { const alias: any = list100; alias[1] = NaN; list100[0] = list100[1]; }
for (let turn = 0; turn < 4; turn++) { swap100(); read100(list100); }
try { attack100(); swap100(); console.log('NaN fromItselfAfterAny', read100(list100), JSON.stringify(list100)); } catch (e) { console.log('NaN fromItselfAfterAny threw', (e as Error).constructor.name); }
const list101: number[] = [1, 2, 3, 4];
function read101(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap101(): void { const held = list101[0]; list101[0] = list101[1]; list101[1] = held; }
function attack101(): void { list101.push(NaN); list101[0] = list101[list101.length - 1]; }
for (let turn = 0; turn < 4; turn++) { swap101(); read101(list101); }
try { attack101(); swap101(); console.log('NaN fromItselfAfterPush', read101(list101), JSON.stringify(list101)); } catch (e) { console.log('NaN fromItselfAfterPush threw', (e as Error).constructor.name); }
const list102: number[] = [1, 2, 3, 4];
function read102(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap102(): void { const held = list102[0]; list102[0] = list102[1]; list102[1] = held; }
function attack102(): void { list102.fill(NaN, 1, 2); list102[0] = list102[1]; }
for (let turn = 0; turn < 4; turn++) { swap102(); read102(list102); }
try { attack102(); swap102(); console.log('NaN fromItselfAfterFill', read102(list102), JSON.stringify(list102)); } catch (e) { console.log('NaN fromItselfAfterFill threw', (e as Error).constructor.name); }
const list103: number[] = [1, 2, 3, 4];
function read103(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap103(): void { const held = list103[0]; list103[0] = list103[1]; list103[1] = held; }
function attack103(): void { const a = [NaN]; const b = [1]; const c = [2]; b[0] = a[0]; c[0] = b[0]; list103[0] = c[0]; }
for (let turn = 0; turn < 4; turn++) { swap103(); read103(list103); }
try { attack103(); swap103(); console.log('NaN chainOfThree', read103(list103), JSON.stringify(list103)); } catch (e) { console.log('NaN chainOfThree threw', (e as Error).constructor.name); }
const list104: number[] = [1, 2, 3, 4];
function read104(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap104(): void { const held = list104[0]; list104[0] = list104[1]; list104[1] = held; }
function attack104(): void { const a = [1]; a[0] = list104[0]; list104[1] = a[0]; a[0] = NaN; list104[2] = a[0]; }
for (let turn = 0; turn < 4; turn++) { swap104(); read104(list104); }
try { attack104(); swap104(); console.log('NaN ringOfTwo', read104(list104), JSON.stringify(list104)); } catch (e) { console.log('NaN ringOfTwo threw', (e as Error).constructor.name); }
const list105: number[] = [1, 2, 3, 4];
function read105(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap105(): void { const held = list105[0]; list105[0] = list105[1]; list105[1] = held; }
function attack105(): void { const other = [NaN, 1]; [list105[0], other[1]] = [other[0], list105[1]]; }
for (let turn = 0; turn < 4; turn++) { swap105(); read105(list105); }
try { attack105(); swap105(); console.log('NaN swapByPattern', read105(list105), JSON.stringify(list105)); } catch (e) { console.log('NaN swapByPattern threw', (e as Error).constructor.name); }
const list106: number[] = [1, 2, 3, 4];
function read106(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap106(): void { const held = list106[0]; list106[0] = list106[1]; list106[1] = held; }
function attack106(): void { const other = [NaN]; list106.push(other[0]); }
for (let turn = 0; turn < 4; turn++) { swap106(); read106(list106); }
try { attack106(); swap106(); console.log('NaN pushOfARead', read106(list106), JSON.stringify(list106)); } catch (e) { console.log('NaN pushOfARead threw', (e as Error).constructor.name); }
const list107: number[] = [1, 2, 3, 4];
function read107(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap107(): void { const held = list107[0]; list107[0] = list107[1]; list107[1] = held; }
function attack107(): void { const other = [NaN]; const made = [other[0], list107[0]]; list107[1] = made[0]; }
for (let turn = 0; turn < 4; turn++) { swap107(); read107(list107); }
try { attack107(); swap107(); console.log('NaN literalOfReads', read107(list107), JSON.stringify(list107)); } catch (e) { console.log('NaN literalOfReads threw', (e as Error).constructor.name); }
const list108: number[] = [1, 2, 3, 4];
function read108(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap108(): void { const held = list108[0]; list108[0] = list108[1]; list108[1] = held; }
function attack108(): void { list108[0] = list108[1] * 1073741824 * 4; list108[2] = list108[0]; }
for (let turn = 0; turn < 4; turn++) { swap108(); read108(list108); }
try { attack108(); swap108(); console.log('NaN readThenArithmetic', read108(list108), JSON.stringify(list108)); } catch (e) { console.log('NaN readThenArithmetic threw', (e as Error).constructor.name); }
const list109: number[] = [1, 2, 3, 4];
function read109(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap109(): void { const held = list109[0]; list109[0] = list109[1]; list109[1] = held; }
function attack109(): void { const other = [NaN]; list109[0] = first(other); }
for (let turn = 0; turn < 4; turn++) { swap109(); read109(list109); }
try { attack109(); swap109(); console.log('NaN readThroughAFunction', read109(list109), JSON.stringify(list109)); } catch (e) { console.log('NaN readThroughAFunction threw', (e as Error).constructor.name); }
const list110: number[] = [1, 2, 3, 4];
function read110(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap110(): void { const held = list110[0]; list110[0] = list110[1]; list110[1] = held; }
function attack110(): void { const other = [NaN]; storeInto(list110, other[0]); }
for (let turn = 0; turn < 4; turn++) { swap110(); read110(list110); }
try { attack110(); swap110(); console.log('NaN storeThroughAFunction', read110(list110), JSON.stringify(list110)); } catch (e) { console.log('NaN storeThroughAFunction threw', (e as Error).constructor.name); }
const list111: number[] = [1, 2, 3, 4];
function read111(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap111(): void { const held = list111[0]; list111[0] = list111[1]; list111[1] = held; }
function attack111(): void { const other: number[] = []; list111[0] = other[0] ?? NaN; }
for (let turn = 0; turn < 4; turn++) { swap111(); read111(list111); }
try { attack111(); swap111(); console.log('NaN readOrDefault', read111(list111), JSON.stringify(list111)); } catch (e) { console.log('NaN readOrDefault threw', (e as Error).constructor.name); }
const list112: number[] = [1, 2, 3, 4];
function read112(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap112(): void { const held = list112[0]; list112[0] = list112[1]; list112[1] = held; }
function attack112(): void { const other = [1]; list112[0] = turns > 0 ? other[0] : NaN; }
for (let turn = 0; turn < 4; turn++) { swap112(); read112(list112); }
try { attack112(); swap112(); console.log('NaN readConditional', read112(list112), JSON.stringify(list112)); } catch (e) { console.log('NaN readConditional threw', (e as Error).constructor.name); }
const list113: number[] = [1, 2, 3, 4];
function read113(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap113(): void { const held = list113[0]; list113[0] = list113[1]; list113[1] = held; }
function attack113(): void { list113[0] = 2147483647; list113[0]++; list113[1] = list113[0]; }
for (let turn = 0; turn < 4; turn++) { swap113(); read113(list113); }
try { attack113(); swap113(); console.log('NaN readIncremented', read113(list113), JSON.stringify(list113)); } catch (e) { console.log('NaN readIncremented threw', (e as Error).constructor.name); }
const list114: number[] = [1, 2, 3, 4];
function read114(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap114(): void { const held = list114[0]; list114[0] = list114[1]; list114[1] = held; }
function attack114(): void { list114[0] = 2147483647; list114[0] += list114[0]; list114[1] = list114[0]; }
for (let turn = 0; turn < 4; turn++) { swap114(); read114(list114); }
try { attack114(); swap114(); console.log('NaN readCompound', read114(list114), JSON.stringify(list114)); } catch (e) { console.log('NaN readCompound threw', (e as Error).constructor.name); }
const list115: number[] = [1, 2, 3, 4];
function read115(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap115(): void { const held = list115[0]; list115[0] = list115[1]; list115[1] = held; }
function attack115(): void { list115[0] = list115[99]; list115[1] = list115[-1 as number]; }
for (let turn = 0; turn < 4; turn++) { swap115(); read115(list115); }
try { attack115(); swap115(); console.log('NaN pastTheEnd', read115(list115), JSON.stringify(list115)); } catch (e) { console.log('NaN pastTheEnd threw', (e as Error).constructor.name); }
const list116: number[] = [1, 2, 3, 4];
function read116(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap116(): void { const held = list116[0]; list116[0] = list116[1]; list116[1] = held; }
function attack116(): void { const other = [1, , 3] as number[]; list116[0] = other[1]; }
for (let turn = 0; turn < 4; turn++) { swap116(); read116(list116); }
try { attack116(); swap116(); console.log('NaN fromHole', read116(list116), JSON.stringify(list116)); } catch (e) { console.log('NaN fromHole threw', (e as Error).constructor.name); }
const list117: number[] = [1, 2, 3, 4];
function read117(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap117(): void { const held = list117[0]; list117[0] = list117[1]; list117[1] = held; }
function attack117(): void { const other = [NaN].slice(); list117[0] = other[0]; const again = list117.slice(); list117[1] = again[0]; }
for (let turn = 0; turn < 4; turn++) { swap117(); read117(list117); }
try { attack117(); swap117(); console.log('NaN copyThenStoreBack', read117(list117), JSON.stringify(list117)); } catch (e) { console.log('NaN copyThenStoreBack threw', (e as Error).constructor.name); }
const list118: number[] = [1, 2, 3, 4];
function read118(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap118(): void { const held = list118[0]; list118[0] = list118[1]; list118[1] = held; }
function attack118(): void { const other = new Float64Array([-2147483649, -2147483649]); list118[0] = other[0]; list118[1] = other[1]!; }
for (let turn = 0; turn < 4; turn++) { swap118(); read118(list118); }
try { attack118(); swap118(); console.log('-2147483649 fromBytes', read118(list118), JSON.stringify(list118)); } catch (e) { console.log('-2147483649 fromBytes threw', (e as Error).constructor.name); }
const list119: number[] = [1, 2, 3, 4];
function read119(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap119(): void { const held = list119[0]; list119[0] = list119[1]; list119[1] = held; }
function attack119(): void { const other = new Uint32Array([4294967295]); list119[0] = other[0]; list119[1] = -2147483649; }
for (let turn = 0; turn < 4; turn++) { swap119(); read119(list119); }
try { attack119(); swap119(); console.log('-2147483649 fromBigInts32', read119(list119), JSON.stringify(list119)); } catch (e) { console.log('-2147483649 fromBigInts32 threw', (e as Error).constructor.name); }
const list120: number[] = [1, 2, 3, 4];
function read120(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap120(): void { const held = list120[0]; list120[0] = list120[1]; list120[1] = held; }
function attack120(): void { const other: ArrayLike<number> = { length: 1, 0: -2147483649 }; list120[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap120(); read120(list120); }
try { attack120(); swap120(); console.log('-2147483649 fromArrayLike', read120(list120), JSON.stringify(list120)); } catch (e) { console.log('-2147483649 fromArrayLike threw', (e as Error).constructor.name); }
const list121: number[] = [1, 2, 3, 4];
function read121(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap121(): void { const held = list121[0]; list121[0] = list121[1]; list121[1] = held; }
function attack121(): void { const other: Record<number, number> = { 0: -2147483649 }; list121[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap121(); read121(list121); }
try { attack121(); swap121(); console.log('-2147483649 fromRecord', read121(list121), JSON.stringify(list121)); } catch (e) { console.log('-2147483649 fromRecord threw', (e as Error).constructor.name); }
const list122: number[] = [1, 2, 3, 4];
function read122(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap122(): void { const held = list122[0]; list122[0] = list122[1]; list122[1] = held; }
function attack122(): void { const other: any = [-2147483649]; list122[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap122(); read122(list122); }
try { attack122(); swap122(); console.log('-2147483649 fromAny', read122(list122), JSON.stringify(list122)); } catch (e) { console.log('-2147483649 fromAny threw', (e as Error).constructor.name); }
const list123: number[] = [1, 2, 3, 4];
function read123(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap123(): void { const held = list123[0]; list123[0] = list123[1]; list123[1] = held; }
function attack123(): void { const other: any = { 0: -2147483649 }; list123[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap123(); read123(list123); }
try { attack123(); swap123(); console.log('-2147483649 fromAnyObject', read123(list123), JSON.stringify(list123)); } catch (e) { console.log('-2147483649 fromAnyObject threw', (e as Error).constructor.name); }
const list124: number[] = [1, 2, 3, 4];
function read124(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap124(): void { const held = list124[0]; list124[0] = list124[1]; list124[1] = held; }
function attack124(): void { (function (..._: number[]) { list124[0] = arguments[0]; })(-2147483649); }
for (let turn = 0; turn < 4; turn++) { swap124(); read124(list124); }
try { attack124(); swap124(); console.log('-2147483649 fromArguments', read124(list124), JSON.stringify(list124)); } catch (e) { console.log('-2147483649 fromArguments threw', (e as Error).constructor.name); }
const list125: number[] = [1, 2, 3, 4];
function read125(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap125(): void { const held = list125[0]; list125[0] = list125[1]; list125[1] = held; }
function attack125(): void { ((...rest: number[]) => { list125[0] = rest[0]; })(-2147483649); }
for (let turn = 0; turn < 4; turn++) { swap125(); read125(list125); }
try { attack125(); swap125(); console.log('-2147483649 fromRest', read125(list125), JSON.stringify(list125)); } catch (e) { console.log('-2147483649 fromRest threw', (e as Error).constructor.name); }
const list126: number[] = [1, 2, 3, 4];
function read126(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap126(): void { const held = list126[0]; list126[0] = list126[1]; list126[1] = held; }
function attack126(): void { const other: number[] = JSON.parse('[1e10]'); list126[0] = other[0]; list126[1] = -2147483649; }
for (let turn = 0; turn < 4; turn++) { swap126(); read126(list126); }
try { attack126(); swap126(); console.log('-2147483649 fromParsed', read126(list126), JSON.stringify(list126)); } catch (e) { console.log('-2147483649 fromParsed threw', (e as Error).constructor.name); }
const list127: number[] = [1, 2, 3, 4];
function read127(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap127(): void { const held = list127[0]; list127[0] = list127[1]; list127[1] = held; }
function attack127(): void { const other = [1].map(() => -2147483649); list127[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap127(); read127(list127); }
try { attack127(); swap127(); console.log('-2147483649 fromMapped', read127(list127), JSON.stringify(list127)); } catch (e) { console.log('-2147483649 fromMapped threw', (e as Error).constructor.name); }
const list128: number[] = [1, 2, 3, 4];
function read128(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap128(): void { const held = list128[0]; list128[0] = list128[1]; list128[1] = held; }
function attack128(): void { const other = [1, 2]; other.fill(-2147483649); list128[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap128(); read128(list128); }
try { attack128(); swap128(); console.log('-2147483649 fromFilled', read128(list128), JSON.stringify(list128)); } catch (e) { console.log('-2147483649 fromFilled threw', (e as Error).constructor.name); }
const list129: number[] = [1, 2, 3, 4];
function read129(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap129(): void { const held = list129[0]; list129[0] = list129[1]; list129[1] = held; }
function attack129(): void { const other = [1, 2]; Object.assign(other, [-2147483649]); list129[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap129(); read129(list129); }
try { attack129(); swap129(); console.log('-2147483649 fromAssigned', read129(list129), JSON.stringify(list129)); } catch (e) { console.log('-2147483649 fromAssigned threw', (e as Error).constructor.name); }
const list130: number[] = [1, 2, 3, 4];
function read130(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap130(): void { const held = list130[0]; list130[0] = list130[1]; list130[1] = held; }
function attack130(): void { const other = [1, 2]; Object.defineProperty(other, 0, { get() { return -2147483649; } }); list130[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap130(); read130(list130); }
try { attack130(); swap130(); console.log('-2147483649 fromGetter', read130(list130), JSON.stringify(list130)); } catch (e) { console.log('-2147483649 fromGetter threw', (e as Error).constructor.name); }
const list131: number[] = [1, 2, 3, 4];
function read131(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap131(): void { const held = list131[0]; list131[0] = list131[1]; list131[1] = held; }
function attack131(): void { const other = [1, 2]; Object.setPrototypeOf(other, Object.assign(Object.create(Array.prototype), { 5: -2147483649 })); list131[0] = other[5]; }
for (let turn = 0; turn < 4; turn++) { swap131(); read131(list131); }
try { attack131(); swap131(); console.log('-2147483649 fromPrototypeOfList', read131(list131), JSON.stringify(list131)); } catch (e) { console.log('-2147483649 fromPrototypeOfList threw', (e as Error).constructor.name); }
const list132: number[] = [1, 2, 3, 4];
function read132(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap132(): void { const held = list132[0]; list132[0] = list132[1]; list132[1] = held; }
function attack132(): void { class Heir extends Array<number> {} (Heir.prototype as any)[5] = -2147483649; const other = new Heir(); other.push(1); list132[0] = other[5]; }
for (let turn = 0; turn < 4; turn++) { swap132(); read132(list132); }
try { attack132(); swap132(); console.log('-2147483649 fromHeirPrototype', read132(list132), JSON.stringify(list132)); } catch (e) { console.log('-2147483649 fromHeirPrototype threw', (e as Error).constructor.name); }
const list133: number[] = [1, 2, 3, 4];
function read133(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap133(): void { const held = list133[0]; list133[0] = list133[1]; list133[1] = held; }
function attack133(): void { const other = new Proxy([1, 2], { get(t, k) { return k === '0' ? -2147483649 : (t as any)[k]; } }); list133[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap133(); read133(list133); }
try { attack133(); swap133(); console.log('-2147483649 fromProxy', read133(list133), JSON.stringify(list133)); } catch (e) { console.log('-2147483649 fromProxy threw', (e as Error).constructor.name); }
const list134: number[] = [1, 2, 3, 4];
function read134(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap134(): void { const held = list134[0]; list134[0] = list134[1]; list134[1] = held; }
function attack134(): void { const other = [[-2147483649], [1]]; list134[0] = other[0][0]; list134[1] = other[1][0]; }
for (let turn = 0; turn < 4; turn++) { swap134(); read134(list134); }
try { attack134(); swap134(); console.log('-2147483649 fromListOfLists', read134(list134), JSON.stringify(list134)); } catch (e) { console.log('-2147483649 fromListOfLists threw', (e as Error).constructor.name); }
const list135: number[] = [1, 2, 3, 4];
function read135(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap135(): void { const held = list135[0]; list135[0] = list135[1]; list135[1] = held; }
function attack135(): void { const other: [number, string] = [-2147483649, 'x']; list135[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap135(); read135(list135); }
try { attack135(); swap135(); console.log('-2147483649 fromTuple', read135(list135), JSON.stringify(list135)); } catch (e) { console.log('-2147483649 fromTuple threw', (e as Error).constructor.name); }
const list136: number[] = [1, 2, 3, 4];
function read136(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap136(): void { const held = list136[0]; list136[0] = list136[1]; list136[1] = held; }
function attack136(): void { const other = turns > 0 ? [1, 2] : [-2147483649]; list136[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap136(); read136(list136); }
try { attack136(); swap136(); console.log('-2147483649 fromUnionOfLists', read136(list136), JSON.stringify(list136)); } catch (e) { console.log('-2147483649 fromUnionOfLists threw', (e as Error).constructor.name); }
const list137: number[] = [1, 2, 3, 4];
function read137(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap137(): void { const held = list137[0]; list137[0] = list137[1]; list137[1] = held; }
function attack137(): void { const other: number[] | Float64Array = turns > 0 ? [1, 2] : new Float64Array([-2147483649]); list137[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap137(); read137(list137); }
try { attack137(); swap137(); console.log('-2147483649 fromListOrBytes', read137(list137), JSON.stringify(list137)); } catch (e) { console.log('-2147483649 fromListOrBytes threw', (e as Error).constructor.name); }
const list138: number[] = [1, 2, 3, 4];
function read138(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap138(): void { const held = list138[0]; list138[0] = list138[1]; list138[1] = held; }
function attack138(): void { const other: any = turns > 0 ? [1] : '7'; list138[0] = other[0]; }
for (let turn = 0; turn < 4; turn++) { swap138(); read138(list138); }
try { attack138(); swap138(); console.log('-2147483649 fromString', read138(list138), JSON.stringify(list138)); } catch (e) { console.log('-2147483649 fromString threw', (e as Error).constructor.name); }
const list139: number[] = [1, 2, 3, 4];
function read139(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap139(): void { const held = list139[0]; list139[0] = list139[1]; list139[1] = held; }
function attack139(): void { const alias: any = list139; alias[1] = -2147483649; list139[0] = list139[1]; }
for (let turn = 0; turn < 4; turn++) { swap139(); read139(list139); }
try { attack139(); swap139(); console.log('-2147483649 fromItselfAfterAny', read139(list139), JSON.stringify(list139)); } catch (e) { console.log('-2147483649 fromItselfAfterAny threw', (e as Error).constructor.name); }
const list140: number[] = [1, 2, 3, 4];
function read140(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap140(): void { const held = list140[0]; list140[0] = list140[1]; list140[1] = held; }
function attack140(): void { list140.push(-2147483649); list140[0] = list140[list140.length - 1]; }
for (let turn = 0; turn < 4; turn++) { swap140(); read140(list140); }
try { attack140(); swap140(); console.log('-2147483649 fromItselfAfterPush', read140(list140), JSON.stringify(list140)); } catch (e) { console.log('-2147483649 fromItselfAfterPush threw', (e as Error).constructor.name); }
const list141: number[] = [1, 2, 3, 4];
function read141(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap141(): void { const held = list141[0]; list141[0] = list141[1]; list141[1] = held; }
function attack141(): void { list141.fill(-2147483649, 1, 2); list141[0] = list141[1]; }
for (let turn = 0; turn < 4; turn++) { swap141(); read141(list141); }
try { attack141(); swap141(); console.log('-2147483649 fromItselfAfterFill', read141(list141), JSON.stringify(list141)); } catch (e) { console.log('-2147483649 fromItselfAfterFill threw', (e as Error).constructor.name); }
const list142: number[] = [1, 2, 3, 4];
function read142(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap142(): void { const held = list142[0]; list142[0] = list142[1]; list142[1] = held; }
function attack142(): void { const a = [-2147483649]; const b = [1]; const c = [2]; b[0] = a[0]; c[0] = b[0]; list142[0] = c[0]; }
for (let turn = 0; turn < 4; turn++) { swap142(); read142(list142); }
try { attack142(); swap142(); console.log('-2147483649 chainOfThree', read142(list142), JSON.stringify(list142)); } catch (e) { console.log('-2147483649 chainOfThree threw', (e as Error).constructor.name); }
const list143: number[] = [1, 2, 3, 4];
function read143(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap143(): void { const held = list143[0]; list143[0] = list143[1]; list143[1] = held; }
function attack143(): void { const a = [1]; a[0] = list143[0]; list143[1] = a[0]; a[0] = -2147483649; list143[2] = a[0]; }
for (let turn = 0; turn < 4; turn++) { swap143(); read143(list143); }
try { attack143(); swap143(); console.log('-2147483649 ringOfTwo', read143(list143), JSON.stringify(list143)); } catch (e) { console.log('-2147483649 ringOfTwo threw', (e as Error).constructor.name); }
const list144: number[] = [1, 2, 3, 4];
function read144(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap144(): void { const held = list144[0]; list144[0] = list144[1]; list144[1] = held; }
function attack144(): void { const other = [-2147483649, 1]; [list144[0], other[1]] = [other[0], list144[1]]; }
for (let turn = 0; turn < 4; turn++) { swap144(); read144(list144); }
try { attack144(); swap144(); console.log('-2147483649 swapByPattern', read144(list144), JSON.stringify(list144)); } catch (e) { console.log('-2147483649 swapByPattern threw', (e as Error).constructor.name); }
const list145: number[] = [1, 2, 3, 4];
function read145(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap145(): void { const held = list145[0]; list145[0] = list145[1]; list145[1] = held; }
function attack145(): void { const other = [-2147483649]; list145.push(other[0]); }
for (let turn = 0; turn < 4; turn++) { swap145(); read145(list145); }
try { attack145(); swap145(); console.log('-2147483649 pushOfARead', read145(list145), JSON.stringify(list145)); } catch (e) { console.log('-2147483649 pushOfARead threw', (e as Error).constructor.name); }
const list146: number[] = [1, 2, 3, 4];
function read146(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap146(): void { const held = list146[0]; list146[0] = list146[1]; list146[1] = held; }
function attack146(): void { const other = [-2147483649]; const made = [other[0], list146[0]]; list146[1] = made[0]; }
for (let turn = 0; turn < 4; turn++) { swap146(); read146(list146); }
try { attack146(); swap146(); console.log('-2147483649 literalOfReads', read146(list146), JSON.stringify(list146)); } catch (e) { console.log('-2147483649 literalOfReads threw', (e as Error).constructor.name); }
const list147: number[] = [1, 2, 3, 4];
function read147(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap147(): void { const held = list147[0]; list147[0] = list147[1]; list147[1] = held; }
function attack147(): void { list147[0] = list147[1] * 1073741824 * 4; list147[2] = list147[0]; }
for (let turn = 0; turn < 4; turn++) { swap147(); read147(list147); }
try { attack147(); swap147(); console.log('-2147483649 readThenArithmetic', read147(list147), JSON.stringify(list147)); } catch (e) { console.log('-2147483649 readThenArithmetic threw', (e as Error).constructor.name); }
const list148: number[] = [1, 2, 3, 4];
function read148(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap148(): void { const held = list148[0]; list148[0] = list148[1]; list148[1] = held; }
function attack148(): void { const other = [-2147483649]; list148[0] = first(other); }
for (let turn = 0; turn < 4; turn++) { swap148(); read148(list148); }
try { attack148(); swap148(); console.log('-2147483649 readThroughAFunction', read148(list148), JSON.stringify(list148)); } catch (e) { console.log('-2147483649 readThroughAFunction threw', (e as Error).constructor.name); }
const list149: number[] = [1, 2, 3, 4];
function read149(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap149(): void { const held = list149[0]; list149[0] = list149[1]; list149[1] = held; }
function attack149(): void { const other = [-2147483649]; storeInto(list149, other[0]); }
for (let turn = 0; turn < 4; turn++) { swap149(); read149(list149); }
try { attack149(); swap149(); console.log('-2147483649 storeThroughAFunction', read149(list149), JSON.stringify(list149)); } catch (e) { console.log('-2147483649 storeThroughAFunction threw', (e as Error).constructor.name); }
const list150: number[] = [1, 2, 3, 4];
function read150(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap150(): void { const held = list150[0]; list150[0] = list150[1]; list150[1] = held; }
function attack150(): void { const other: number[] = []; list150[0] = other[0] ?? -2147483649; }
for (let turn = 0; turn < 4; turn++) { swap150(); read150(list150); }
try { attack150(); swap150(); console.log('-2147483649 readOrDefault', read150(list150), JSON.stringify(list150)); } catch (e) { console.log('-2147483649 readOrDefault threw', (e as Error).constructor.name); }
const list151: number[] = [1, 2, 3, 4];
function read151(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap151(): void { const held = list151[0]; list151[0] = list151[1]; list151[1] = held; }
function attack151(): void { const other = [1]; list151[0] = turns > 0 ? other[0] : -2147483649; }
for (let turn = 0; turn < 4; turn++) { swap151(); read151(list151); }
try { attack151(); swap151(); console.log('-2147483649 readConditional', read151(list151), JSON.stringify(list151)); } catch (e) { console.log('-2147483649 readConditional threw', (e as Error).constructor.name); }
const list152: number[] = [1, 2, 3, 4];
function read152(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap152(): void { const held = list152[0]; list152[0] = list152[1]; list152[1] = held; }
function attack152(): void { list152[0] = 2147483647; list152[0]++; list152[1] = list152[0]; }
for (let turn = 0; turn < 4; turn++) { swap152(); read152(list152); }
try { attack152(); swap152(); console.log('-2147483649 readIncremented', read152(list152), JSON.stringify(list152)); } catch (e) { console.log('-2147483649 readIncremented threw', (e as Error).constructor.name); }
const list153: number[] = [1, 2, 3, 4];
function read153(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap153(): void { const held = list153[0]; list153[0] = list153[1]; list153[1] = held; }
function attack153(): void { list153[0] = 2147483647; list153[0] += list153[0]; list153[1] = list153[0]; }
for (let turn = 0; turn < 4; turn++) { swap153(); read153(list153); }
try { attack153(); swap153(); console.log('-2147483649 readCompound', read153(list153), JSON.stringify(list153)); } catch (e) { console.log('-2147483649 readCompound threw', (e as Error).constructor.name); }
const list154: number[] = [1, 2, 3, 4];
function read154(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap154(): void { const held = list154[0]; list154[0] = list154[1]; list154[1] = held; }
function attack154(): void { list154[0] = list154[99]; list154[1] = list154[-1 as number]; }
for (let turn = 0; turn < 4; turn++) { swap154(); read154(list154); }
try { attack154(); swap154(); console.log('-2147483649 pastTheEnd', read154(list154), JSON.stringify(list154)); } catch (e) { console.log('-2147483649 pastTheEnd threw', (e as Error).constructor.name); }
const list155: number[] = [1, 2, 3, 4];
function read155(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap155(): void { const held = list155[0]; list155[0] = list155[1]; list155[1] = held; }
function attack155(): void { const other = [1, , 3] as number[]; list155[0] = other[1]; }
for (let turn = 0; turn < 4; turn++) { swap155(); read155(list155); }
try { attack155(); swap155(); console.log('-2147483649 fromHole', read155(list155), JSON.stringify(list155)); } catch (e) { console.log('-2147483649 fromHole threw', (e as Error).constructor.name); }
const list156: number[] = [1, 2, 3, 4];
function read156(v: number[]): string { let text = v.length + ':'; let sum = 0; for (let at = 0; at < v.length; at++) { text += show(v[at] + 1) + ','; sum += v[at] | 0; } return text + show(sum) + ' ' + show(v[0]) + ' ' + v.join(); }
function swap156(): void { const held = list156[0]; list156[0] = list156[1]; list156[1] = held; }
function attack156(): void { const other = [-2147483649].slice(); list156[0] = other[0]; const again = list156.slice(); list156[1] = again[0]; }
for (let turn = 0; turn < 4; turn++) { swap156(); read156(list156); }
try { attack156(); swap156(); console.log('-2147483649 copyThenStoreBack', read156(list156), JSON.stringify(list156)); } catch (e) { console.log('-2147483649 copyThenStoreBack threw', (e as Error).constructor.name); }
export {};
