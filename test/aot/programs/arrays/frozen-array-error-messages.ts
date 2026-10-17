// Arrays that are frozen, sealed or not extensible: everything that iterates over them, reads them or tries to write to them.
const marks: any[] = [];
function count(...all: any[]): number { return all.length; }
function show(v: any): string { return JSON.stringify(v, (k, x) => x === undefined ? "undefined" : typeof x === "number" && Object.is(x, -0) ? "-0" : x) ?? "undefined"; }
function holes(x: any[]): string { let s = ""; for (let i = 0; i < x.length && i < 8; i++) s += i in x ? "x" : "_"; return s; }
const table: Array<[string, (x: any) => any]> = [];
function u_forOf(x: any): any { const out: any[] = []; for (const v of x) out.push(v); return out; }
table.push(["u_forOf", u_forOf]);
function u_forOfBreak(x: any): any { const out: any[] = []; for (const v of x) { out.push(v); if (out.length === 2) break; } return out; }
table.push(["u_forOfBreak", u_forOfBreak]);
function u_forOfEntries(x: any): any { const out: any[] = []; for (const [i, v] of x.entries()) out.push(i, v); return out; }
table.push(["u_forOfEntries", u_forOfEntries]);
function u_forOfKeys(x: any): any { const out: any[] = []; for (const i of x.keys()) out.push(i); return out; }
table.push(["u_forOfKeys", u_forOfKeys]);
function u_forIndex(x: any): any { const out: any[] = []; for (let i = 0; i < x.length; i++) out.push(x[i]); return out; }
table.push(["u_forIndex", u_forIndex]);
function u_forIn(x: any): any { const out: any[] = []; for (const i in x) out.push(i); return out; }
table.push(["u_forIn", u_forIn]);
function u_spread(x: any): any { return [...x]; }
table.push(["u_spread", u_spread]);
function u_spreadTwice(x: any): any { return [0, ...x, 9, ...x]; }
table.push(["u_spreadTwice", u_spreadTwice]);
function u_spreadCall(x: any): any { return count(...x); }
table.push(["u_spreadCall", u_spreadCall]);
function u_arrayFrom(x: any): any { return Array.from(x); }
table.push(["u_arrayFrom", u_arrayFrom]);
function u_arrayFromMapped(x: any): any { return Array.from(x, (v: any) => [v]); }
table.push(["u_arrayFromMapped", u_arrayFromMapped]);
function u_destructure(x: any): any { const [a, b, ...rest] = x; return [a, b, rest]; }
table.push(["u_destructure", u_destructure]);
function u_destructureOne(x: any): any { const [a] = x; return [a]; }
table.push(["u_destructureOne", u_destructureOne]);
function u_newSet(x: any): any { return [...new Set(x)]; }
table.push(["u_newSet", u_newSet]);
function u_objectEntries(x: any): any { return Object.entries(x); }
table.push(["u_objectEntries", u_objectEntries]);
function u_map(x: any): any { return x.map((v: any) => [v]); }
table.push(["u_map", u_map]);
function u_filter(x: any): any { return x.filter((v: any) => v !== 2); }
table.push(["u_filter", u_filter]);
function u_some(x: any): any { return x.some((v: any) => v === 3); }
table.push(["u_some", u_some]);
function u_every(x: any): any { return x.every((v: any) => v !== 99); }
table.push(["u_every", u_every]);
function u_find(x: any): any { return x.find((v: any) => v !== 1); }
table.push(["u_find", u_find]);
function u_findLast(x: any): any { return x.findLast((v: any) => v !== 1); }
table.push(["u_findLast", u_findLast]);
function u_findIndex(x: any): any { return x.findIndex((v: any) => v === 3); }
table.push(["u_findIndex", u_findIndex]);
function u_forEach(x: any): any { const out: any[] = []; x.forEach((v: any, i: number) => { out.push(i, v); }); return out; }
table.push(["u_forEach", u_forEach]);
function u_reduce(x: any): any { return x.reduce((a: any[], v: any) => { a.push(v); return a; }, []); }
table.push(["u_reduce", u_reduce]);
function u_flatMap(x: any): any { return x.flatMap((v: any) => [v, v]); }
table.push(["u_flatMap", u_flatMap]);
function u_includes(x: any): any { return [x.includes(3), x.includes(undefined), x.includes("b")]; }
table.push(["u_includes", u_includes]);
function u_indexOf(x: any): any { return [x.indexOf(3), x.lastIndexOf(1), x.indexOf("c")]; }
table.push(["u_indexOf", u_indexOf]);
function u_join(x: any): any { return x.join("-"); }
table.push(["u_join", u_join]);
function u_slice(x: any): any { return [x.slice(1), x.slice(-1), x.slice()]; }
table.push(["u_slice", u_slice]);
function u_concat(x: any): any { return [x.concat(x), [0].concat(x)]; }
table.push(["u_concat", u_concat]);
function u_flat(x: any): any { return x.flat(); }
table.push(["u_flat", u_flat]);
function u_at(x: any): any { return [x.at(0), x.at(-1), x.at(5)]; }
table.push(["u_at", u_at]);
function u_toSorted(x: any): any { return x.toSorted(); }
table.push(["u_toSorted", u_toSorted]);
function u_toReversed(x: any): any { return x.toReversed(); }
table.push(["u_toReversed", u_toReversed]);
function u_toSpliced(x: any): any { return x.toSpliced(0, 1, 8); }
table.push(["u_toSpliced", u_toSpliced]);
function u_with(x: any): any { return x.length ? x.with(0, 8) : "empty"; }
table.push(["u_with", u_with]);
function u_stringify(x: any): any { return JSON.stringify(x); }
table.push(["u_stringify", u_stringify]);
function u_toString(x: any): any { return String(x); }
table.push(["u_toString", u_toString]);
function u_length(x: any): any { return x.length; }
table.push(["u_length", u_length]);
function u_has(x: any): any { return [0 in x, 1 in x, 9 in x, Object.hasOwn(x, 1)]; }
table.push(["u_has", u_has]);
function u_state(x: any): any { return [Object.isFrozen(x), Object.isSealed(x), Object.isExtensible(x), Array.isArray(x)]; }
table.push(["u_state", u_state]);
function u_descriptors(x: any): any { return [Object.getOwnPropertyDescriptor(x, 0), Object.getOwnPropertyDescriptor(x, "length")]; }
table.push(["u_descriptors", u_descriptors]);
function u_keys(x: any): any { return [Object.keys(x), Reflect.ownKeys(x)]; }
table.push(["u_keys", u_keys]);
function u_structuredClone(x: any): any { return structuredClone(x); }
table.push(["u_structuredClone", u_structuredClone]);
function u_push(x: any): any { x.push(5); return x; }
table.push(["u_push", u_push]);
function u_pop(x: any): any { x.pop(); return x; }
table.push(["u_pop", u_pop]);
function u_shift(x: any): any { x.shift(); return x; }
table.push(["u_shift", u_shift]);
function u_unshift(x: any): any { x.unshift(5); return x; }
table.push(["u_unshift", u_unshift]);
function u_store(x: any): any { x[0] = 5; return x; }
table.push(["u_store", u_store]);
function u_storeBeyond(x: any): any { x[x.length] = 5; return x; }
table.push(["u_storeBeyond", u_storeBeyond]);
function u_storeFar(x: any): any { x[500] = 5; return x; }
table.push(["u_storeFar", u_storeFar]);
function u_delete(x: any): any { delete x[0]; return x; }
table.push(["u_delete", u_delete]);
function u_lengthLess(x: any): any { x.length = 0; return x; }
table.push(["u_lengthLess", u_lengthLess]);
function u_lengthMore(x: any): any { x.length = 90; return x; }
table.push(["u_lengthMore", u_lengthMore]);
function u_lengthSame(x: any): any { x.length = x.length; return x; }
table.push(["u_lengthSame", u_lengthSame]);
function u_sort(x: any): any { x.sort(); return x; }
table.push(["u_sort", u_sort]);
function u_reverse(x: any): any { x.reverse(); return x; }
table.push(["u_reverse", u_reverse]);
function u_fill(x: any): any { x.fill(5); return x; }
table.push(["u_fill", u_fill]);
function u_splice(x: any): any { x.splice(0, 1); return x; }
table.push(["u_splice", u_splice]);
function u_copyWithin(x: any): any { x.copyWithin(0, 1); return x; }
table.push(["u_copyWithin", u_copyWithin]);
function u_named(x: any): any { x.extra = 5; return x; }
table.push(["u_named", u_named]);
function u_define(x: any): any { Object.defineProperty(x, 0, { value: 5 }); return x; }
table.push(["u_define", u_define]);
function u_defineSame(x: any): any { if (x.length) Object.defineProperty(x, 0, { value: x[0] }); return x; }
table.push(["u_defineSame", u_defineSame]);
function u_reflectSet(x: any): any { marks.push(Reflect.set(x, 0, 5)); return x; }
table.push(["u_reflectSet", u_reflectSet]);
function u_reflectDelete(x: any): any { marks.push(Reflect.deleteProperty(x, 0)); return x; }
table.push(["u_reflectDelete", u_reflectDelete]);
function u_setPrototype(x: any): any { Object.setPrototypeOf(x, null); return x; }
table.push(["u_setPrototype", u_setPrototype]);
function u_assign(x: any): any { Object.assign(x, [5]); return x; }
table.push(["u_assign", u_assign]);
function u_storeWhileIterating(x: any): any { const out: any[] = []; for (const v of x) { out.push(v); try { x[x.length - 1] = "changed"; } catch (e) { out.push("refused"); } } marks.push(out); return x; }
table.push(["u_storeWhileIterating", u_storeWhileIterating]);
function u_asPrototype(x: any): any { const o = Object.create(x); try { o[0] = 5; } catch (e) { marks.push("refused"); } try { o[9] = 6; } catch (e) { marks.push("refused"); } marks.push(o[0], o[9], Object.hasOwn(o, 0), Object.hasOwn(o, 9)); return x; }
table.push(["u_asPrototype", u_asPrototype]);
function u_asPrototypeLater(x: any): any { const o: any = { }; Object.setPrototypeOf(o, x); try { o[0] = 5; } catch (e) { marks.push("refused"); } marks.push(o[0], Object.hasOwn(o, 0), o.length); return x; }
table.push(["u_asPrototypeLater", u_asPrototypeLater]);
function u_refusedThenRead(x: any): any { try { x[0] = 5; } catch (e) { marks.push("refused"); } const out: any[] = []; for (const v of x) out.push(v); marks.push(out, [...x], x.includes(3), x.indexOf(3), x.map((v: any) => v), x.length, Object.isFrozen(x)); return x; }
table.push(["u_refusedThenRead", u_refusedThenRead]);
function u_readThenRefused(x: any): any { const out: any[] = []; for (const v of x) out.push(v); marks.push(out, x.slice()); try { x.push(1); } catch (e) { marks.push("refused"); } marks.push([...x]); return x; }
table.push(["u_readThenRefused", u_readThenRefused]);
function u_sealAfterwards(x: any): any { Object.seal(x); marks.push(Object.isSealed(x), Object.isFrozen(x)); return x; }
table.push(["u_sealAfterwards", u_sealAfterwards]);
function u_freezeAfterwards(x: any): any { Object.freeze(x); marks.push(Object.isSealed(x), Object.isFrozen(x), Object.getOwnPropertyDescriptor(x, 0)); return x; }
table.push(["u_freezeAfterwards", u_freezeAfterwards]);
function u_preventAfterwards(x: any): any { Object.preventExtensions(x); marks.push(Object.isExtensible(x)); return x; }
table.push(["u_preventAfterwards", u_preventAfterwards]);
function u_defineLength(x: any): any { Object.defineProperty(x, "length", { writable: false }); marks.push(Object.getOwnPropertyDescriptor(x, "length")); return x; }
table.push(["u_defineLength", u_defineLength]);
function u_defineLengthWritable(x: any): any { Object.defineProperty(x, "length", { writable: true }); return x; }
table.push(["u_defineLengthWritable", u_defineLengthWritable]);
function u_defineAccessor(x: any): any { Object.defineProperty(x, 0, { get() { return 5; } }); return x; }
table.push(["u_defineAccessor", u_defineAccessor]);
function u_defineEnumerable(x: any): any { Object.defineProperty(x, 0, { enumerable: false }); return x; }
table.push(["u_defineEnumerable", u_defineEnumerable]);
function u_defineNew(x: any): any { Object.defineProperty(x, x.length, { value: 5 }); return x; }
table.push(["u_defineNew", u_defineNew]);
function u_symbolProperty(x: any): any { x[Symbol.iterator] = null; return x; }
table.push(["u_symbolProperty", u_symbolProperty]);
function u_ownMethod(x: any): any { x.map = null; return x; }
table.push(["u_ownMethod", u_ownMethod]);
function u_popWhileIterating(x: any): any { const out: any[] = []; for (const v of x) { out.push(v); try { x.pop(); } catch (e) { out.push("refused"); } } marks.push(out); return x; }
table.push(["u_popWhileIterating", u_popWhileIterating]);
function t_forOf(x: readonly any[]): any { const out: any[] = []; for (const v of x) out.push(v); return out; }
table.push(["t_forOf", t_forOf]);
function t_forOfBreak(x: readonly any[]): any { const out: any[] = []; for (const v of x) { out.push(v); if (out.length === 2) break; } return out; }
table.push(["t_forOfBreak", t_forOfBreak]);
function t_forOfEntries(x: readonly any[]): any { const out: any[] = []; for (const [i, v] of x.entries()) out.push(i, v); return out; }
table.push(["t_forOfEntries", t_forOfEntries]);
function t_forOfKeys(x: readonly any[]): any { const out: any[] = []; for (const i of x.keys()) out.push(i); return out; }
table.push(["t_forOfKeys", t_forOfKeys]);
function t_forIndex(x: readonly any[]): any { const out: any[] = []; for (let i = 0; i < x.length; i++) out.push(x[i]); return out; }
table.push(["t_forIndex", t_forIndex]);
function t_forIn(x: readonly any[]): any { const out: any[] = []; for (const i in x) out.push(i); return out; }
table.push(["t_forIn", t_forIn]);
function t_spread(x: readonly any[]): any { return [...x]; }
table.push(["t_spread", t_spread]);
function t_spreadTwice(x: readonly any[]): any { return [0, ...x, 9, ...x]; }
table.push(["t_spreadTwice", t_spreadTwice]);
function t_spreadCall(x: readonly any[]): any { return count(...x); }
table.push(["t_spreadCall", t_spreadCall]);
function t_arrayFrom(x: readonly any[]): any { return Array.from(x); }
table.push(["t_arrayFrom", t_arrayFrom]);
function t_arrayFromMapped(x: readonly any[]): any { return Array.from(x, (v: any) => [v]); }
table.push(["t_arrayFromMapped", t_arrayFromMapped]);
function t_destructure(x: readonly any[]): any { const [a, b, ...rest] = x; return [a, b, rest]; }
table.push(["t_destructure", t_destructure]);
function t_destructureOne(x: readonly any[]): any { const [a] = x; return [a]; }
table.push(["t_destructureOne", t_destructureOne]);
function t_newSet(x: readonly any[]): any { return [...new Set(x)]; }
table.push(["t_newSet", t_newSet]);
function t_objectEntries(x: readonly any[]): any { return Object.entries(x); }
table.push(["t_objectEntries", t_objectEntries]);
function t_map(x: readonly any[]): any { return x.map((v: any) => [v]); }
table.push(["t_map", t_map]);
function t_filter(x: readonly any[]): any { return x.filter((v: any) => v !== 2); }
table.push(["t_filter", t_filter]);
function t_some(x: readonly any[]): any { return x.some((v: any) => v === 3); }
table.push(["t_some", t_some]);
function t_every(x: readonly any[]): any { return x.every((v: any) => v !== 99); }
table.push(["t_every", t_every]);
function t_find(x: readonly any[]): any { return x.find((v: any) => v !== 1); }
table.push(["t_find", t_find]);
function t_findLast(x: readonly any[]): any { return x.findLast((v: any) => v !== 1); }
table.push(["t_findLast", t_findLast]);
function t_findIndex(x: readonly any[]): any { return x.findIndex((v: any) => v === 3); }
table.push(["t_findIndex", t_findIndex]);
function t_forEach(x: readonly any[]): any { const out: any[] = []; x.forEach((v: any, i: number) => { out.push(i, v); }); return out; }
table.push(["t_forEach", t_forEach]);
function t_reduce(x: readonly any[]): any { return x.reduce((a: any[], v: any) => { a.push(v); return a; }, []); }
table.push(["t_reduce", t_reduce]);
function t_flatMap(x: readonly any[]): any { return x.flatMap((v: any) => [v, v]); }
table.push(["t_flatMap", t_flatMap]);
function t_includes(x: readonly any[]): any { return [x.includes(3), x.includes(undefined), x.includes("b")]; }
table.push(["t_includes", t_includes]);
function t_indexOf(x: readonly any[]): any { return [x.indexOf(3), x.lastIndexOf(1), x.indexOf("c")]; }
table.push(["t_indexOf", t_indexOf]);
function t_join(x: readonly any[]): any { return x.join("-"); }
table.push(["t_join", t_join]);
function t_slice(x: readonly any[]): any { return [x.slice(1), x.slice(-1), x.slice()]; }
table.push(["t_slice", t_slice]);
function t_concat(x: readonly any[]): any { return [x.concat(x), [0].concat(x)]; }
table.push(["t_concat", t_concat]);
function t_flat(x: readonly any[]): any { return x.flat(); }
table.push(["t_flat", t_flat]);
function t_at(x: readonly any[]): any { return [x.at(0), x.at(-1), x.at(5)]; }
table.push(["t_at", t_at]);
function t_toSorted(x: readonly any[]): any { return x.toSorted(); }
table.push(["t_toSorted", t_toSorted]);
function t_toReversed(x: readonly any[]): any { return x.toReversed(); }
table.push(["t_toReversed", t_toReversed]);
function t_toSpliced(x: readonly any[]): any { return x.toSpliced(0, 1, 8); }
table.push(["t_toSpliced", t_toSpliced]);
function t_with(x: readonly any[]): any { return x.length ? x.with(0, 8) : "empty"; }
table.push(["t_with", t_with]);
function t_stringify(x: readonly any[]): any { return JSON.stringify(x); }
table.push(["t_stringify", t_stringify]);
function t_toString(x: readonly any[]): any { return String(x); }
table.push(["t_toString", t_toString]);
function t_length(x: readonly any[]): any { return x.length; }
table.push(["t_length", t_length]);
function t_has(x: readonly any[]): any { return [0 in x, 1 in x, 9 in x, Object.hasOwn(x, 1)]; }
table.push(["t_has", t_has]);
function t_state(x: readonly any[]): any { return [Object.isFrozen(x), Object.isSealed(x), Object.isExtensible(x), Array.isArray(x)]; }
table.push(["t_state", t_state]);
function t_descriptors(x: readonly any[]): any { return [Object.getOwnPropertyDescriptor(x, 0), Object.getOwnPropertyDescriptor(x, "length")]; }
table.push(["t_descriptors", t_descriptors]);
function t_keys(x: readonly any[]): any { return [Object.keys(x), Reflect.ownKeys(x)]; }
table.push(["t_keys", t_keys]);
function t_structuredClone(x: readonly any[]): any { return structuredClone(x); }
table.push(["t_structuredClone", t_structuredClone]);
function t_push(x: any[]): any { x.push(5); return x; }
table.push(["t_push", t_push]);
function t_pop(x: any[]): any { x.pop(); return x; }
table.push(["t_pop", t_pop]);
function t_shift(x: any[]): any { x.shift(); return x; }
table.push(["t_shift", t_shift]);
function t_unshift(x: any[]): any { x.unshift(5); return x; }
table.push(["t_unshift", t_unshift]);
function t_store(x: any[]): any { x[0] = 5; return x; }
table.push(["t_store", t_store]);
function t_storeBeyond(x: any[]): any { x[x.length] = 5; return x; }
table.push(["t_storeBeyond", t_storeBeyond]);
function t_storeFar(x: any[]): any { x[500] = 5; return x; }
table.push(["t_storeFar", t_storeFar]);
function t_delete(x: any[]): any { delete x[0]; return x; }
table.push(["t_delete", t_delete]);
function t_lengthLess(x: any[]): any { x.length = 0; return x; }
table.push(["t_lengthLess", t_lengthLess]);
function t_lengthMore(x: any[]): any { x.length = 90; return x; }
table.push(["t_lengthMore", t_lengthMore]);
function t_lengthSame(x: any[]): any { x.length = x.length; return x; }
table.push(["t_lengthSame", t_lengthSame]);
function t_sort(x: any[]): any { x.sort(); return x; }
table.push(["t_sort", t_sort]);
function t_reverse(x: any[]): any { x.reverse(); return x; }
table.push(["t_reverse", t_reverse]);
function t_fill(x: any[]): any { x.fill(5); return x; }
table.push(["t_fill", t_fill]);
function t_splice(x: any[]): any { x.splice(0, 1); return x; }
table.push(["t_splice", t_splice]);
function t_copyWithin(x: any[]): any { x.copyWithin(0, 1); return x; }
table.push(["t_copyWithin", t_copyWithin]);
function t_named(x: any): any { x.extra = 5; return x; }
table.push(["t_named", t_named]);
function t_define(x: any[]): any { Object.defineProperty(x, 0, { value: 5 }); return x; }
table.push(["t_define", t_define]);
function t_defineSame(x: any[]): any { if (x.length) Object.defineProperty(x, 0, { value: x[0] }); return x; }
table.push(["t_defineSame", t_defineSame]);
function t_reflectSet(x: any[]): any { marks.push(Reflect.set(x, 0, 5)); return x; }
table.push(["t_reflectSet", t_reflectSet]);
function t_reflectDelete(x: any[]): any { marks.push(Reflect.deleteProperty(x, 0)); return x; }
table.push(["t_reflectDelete", t_reflectDelete]);
function t_setPrototype(x: any[]): any { Object.setPrototypeOf(x, null); return x; }
table.push(["t_setPrototype", t_setPrototype]);
function t_assign(x: any[]): any { Object.assign(x, [5]); return x; }
table.push(["t_assign", t_assign]);
function t_storeWhileIterating(x: any[]): any { const out: any[] = []; for (const v of x) { out.push(v); try { x[x.length - 1] = "changed"; } catch (e) { out.push("refused"); } } marks.push(out); return x; }
table.push(["t_storeWhileIterating", t_storeWhileIterating]);
function t_asPrototype(x: any[]): any { const o = Object.create(x); try { o[0] = 5; } catch (e) { marks.push("refused"); } try { o[9] = 6; } catch (e) { marks.push("refused"); } marks.push(o[0], o[9], Object.hasOwn(o, 0), Object.hasOwn(o, 9)); return x; }
table.push(["t_asPrototype", t_asPrototype]);
function t_asPrototypeLater(x: any[]): any { const o: any = { }; Object.setPrototypeOf(o, x); try { o[0] = 5; } catch (e) { marks.push("refused"); } marks.push(o[0], Object.hasOwn(o, 0), o.length); return x; }
table.push(["t_asPrototypeLater", t_asPrototypeLater]);
function t_refusedThenRead(x: any[]): any { try { x[0] = 5; } catch (e) { marks.push("refused"); } const out: any[] = []; for (const v of x) out.push(v); marks.push(out, [...x], x.includes(3), x.indexOf(3), x.map((v: any) => v), x.length, Object.isFrozen(x)); return x; }
table.push(["t_refusedThenRead", t_refusedThenRead]);
function t_readThenRefused(x: any[]): any { const out: any[] = []; for (const v of x) out.push(v); marks.push(out, x.slice()); try { x.push(1); } catch (e) { marks.push("refused"); } marks.push([...x]); return x; }
table.push(["t_readThenRefused", t_readThenRefused]);
function t_sealAfterwards(x: any[]): any { Object.seal(x); marks.push(Object.isSealed(x), Object.isFrozen(x)); return x; }
table.push(["t_sealAfterwards", t_sealAfterwards]);
function t_freezeAfterwards(x: any[]): any { Object.freeze(x); marks.push(Object.isSealed(x), Object.isFrozen(x), Object.getOwnPropertyDescriptor(x, 0)); return x; }
table.push(["t_freezeAfterwards", t_freezeAfterwards]);
function t_preventAfterwards(x: any[]): any { Object.preventExtensions(x); marks.push(Object.isExtensible(x)); return x; }
table.push(["t_preventAfterwards", t_preventAfterwards]);
function t_defineLength(x: any[]): any { Object.defineProperty(x, "length", { writable: false }); marks.push(Object.getOwnPropertyDescriptor(x, "length")); return x; }
table.push(["t_defineLength", t_defineLength]);
function t_defineLengthWritable(x: any[]): any { Object.defineProperty(x, "length", { writable: true }); return x; }
table.push(["t_defineLengthWritable", t_defineLengthWritable]);
function t_defineAccessor(x: any[]): any { Object.defineProperty(x, 0, { get() { return 5; } }); return x; }
table.push(["t_defineAccessor", t_defineAccessor]);
function t_defineEnumerable(x: any[]): any { Object.defineProperty(x, 0, { enumerable: false }); return x; }
table.push(["t_defineEnumerable", t_defineEnumerable]);
function t_defineNew(x: any[]): any { Object.defineProperty(x, x.length, { value: 5 }); return x; }
table.push(["t_defineNew", t_defineNew]);
function t_symbolProperty(x: any): any { x[Symbol.iterator] = null; return x; }
table.push(["t_symbolProperty", t_symbolProperty]);
function t_ownMethod(x: any): any { x.map = null; return x; }
table.push(["t_ownMethod", t_ownMethod]);
function t_popWhileIterating(x: any[]): any { const out: any[] = []; for (const v of x) { out.push(v); try { x.pop(); } catch (e) { out.push("refused"); } } marks.push(out); return x; }
table.push(["t_popWhileIterating", t_popWhileIterating]);
const makes: Array<[string, () => any[]]> = [["ints", () => [1, 2, 3]], ["doubles", () => [1.5, 2.5, 3.5]], ["strings", () => ["a", "b", "c"]], ["mixed", () => [1, "b", null, undefined, 2.5, { k: 1 }]], ["holes", () => [1, , 3]], ["empty", () => []], ["one", () => [7]], ["long", () => Array.from({ length: 70 }, (_, i) => i * 2)], ["nested", () => [[1, 2], [3, 4]]], ["pairs", () => [["a", 1], ["b", 2]]]];
const states: Array<[string, (x: any[]) => any]> = [["as made", (x: any[]) => x], ["frozen", (x: any[]) => Object.freeze(x)], ["sealed", (x: any[]) => Object.seal(x)], ["not extensible", (x: any[]) => Object.preventExtensions(x)], ["frozen twice", (x: any[]) => Object.freeze(Object.freeze(x))], ["sealed, then frozen", (x: any[]) => Object.freeze(Object.seal(x))]];
const lines: string[] = [];
for (const [label, f] of table) {
    for (const [kind, make] of makes) {
        for (const [state, put] of states) {
            marks.length = 0;
            const x = put(make());
            let said: string;
            try { said = show(f(x)); } catch (e) { said = "THROWS " + (e as Error).constructor.name + ": " + (e as Error).message; }
            lines.push(label + " | " + kind + " | " + state + " | " + said + " | " + show(marks) + " | " + show(x) + " " + holes(x) + " " + x.length);
        }
    }
}
function literal(): number[] { return [1, 2, 3]; }
function words(): string[] { return ["a", "b"]; }
{
    const a = literal(), b = literal(), c = words(), d = words();
    Object.freeze(a); Object.freeze(c);
    b[0] = 9; b.push(4); d[1] = "z";
    const e = literal(), f = words();
    lines.push("arrays of one literal | " + show([a, b, c, d, e, f, Object.isFrozen(a), Object.isFrozen(b), Object.isFrozen(e)]));
    try { a[0] = 5; } catch (x) { lines.push("the frozen one refuses"); }
    lines.push("arrays of one literal, afterwards | " + show([a, b, literal(), Object.isFrozen(a), Object.isFrozen(literal())]));
}
console.log(lines.join("\n"));
