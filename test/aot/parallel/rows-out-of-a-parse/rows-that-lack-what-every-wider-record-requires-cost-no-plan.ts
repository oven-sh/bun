// Twelve records have `a`, `b`, `c` and `id`, and each requires a name of its own beside them. The fifteen rows below have some of `a`, `b`, `c` in some order and then `id`:
// every record has all of a row's names and none can be filled from it. A record that requires more than the row has is refused before a plan is built: the only plans are the twelve of the typed rows.
// COUNTER: RecordPlansTried <= 12
// COUNTER: ObjectsParsedIntoOrdinaryObjects >= 15
// COUNTER: ObjectsParsedIntoRecords >= 12
interface Kind0 { a: number; b: number; c: number; id: number; own0: number }
interface Kind1 { a: number; b: number; c: number; id: number; own1: number }
interface Kind2 { a: number; b: number; c: number; id: number; own2: number }
interface Kind3 { a: number; b: number; c: number; id: number; own3: number }
interface Kind4 { a: number; b: number; c: number; id: number; own4: number }
interface Kind5 { a: number; b: number; c: number; id: number; own5: number }
interface Kind6 { a: number; b: number; c: number; id: number; own6: number }
interface Kind7 { a: number; b: number; c: number; id: number; own7: number }
interface Kind8 { a: number; b: number; c: number; id: number; own8: number }
interface Kind9 { a: number; b: number; c: number; id: number; own9: number }
interface Kind10 { a: number; b: number; c: number; id: number; own10: number }
interface Kind11 { a: number; b: number; c: number; id: number; own11: number }
const kind0: Kind0[] = JSON.parse('[{"a":1,"b":2,"c":3,"own0":0,"id":2}]');
const kind1: Kind1[] = JSON.parse('[{"a":1,"b":2,"c":3,"own1":1,"id":2}]');
const kind2: Kind2[] = JSON.parse('[{"a":1,"b":2,"c":3,"own2":2,"id":2}]');
const kind3: Kind3[] = JSON.parse('[{"a":1,"b":2,"c":3,"own3":3,"id":2}]');
const kind4: Kind4[] = JSON.parse('[{"a":1,"b":2,"c":3,"own4":4,"id":2}]');
const kind5: Kind5[] = JSON.parse('[{"a":1,"b":2,"c":3,"own5":5,"id":2}]');
const kind6: Kind6[] = JSON.parse('[{"a":1,"b":2,"c":3,"own6":6,"id":2}]');
const kind7: Kind7[] = JSON.parse('[{"a":1,"b":2,"c":3,"own7":7,"id":2}]');
const kind8: Kind8[] = JSON.parse('[{"a":1,"b":2,"c":3,"own8":8,"id":2}]');
const kind9: Kind9[] = JSON.parse('[{"a":1,"b":2,"c":3,"own9":9,"id":2}]');
const kind10: Kind10[] = JSON.parse('[{"a":1,"b":2,"c":3,"own10":10,"id":2}]');
const kind11: Kind11[] = JSON.parse('[{"a":1,"b":2,"c":3,"own11":11,"id":2}]');
let sum = kind0[0]!.own0 + kind1[0]!.own1 + kind2[0]!.own2 + kind3[0]!.own3 + kind4[0]!.own4 + kind5[0]!.own5 + kind6[0]!.own6 + kind7[0]!.own7 + kind8[0]!.own8 + kind9[0]!.own9 + kind10[0]!.own10 + kind11[0]!.own11;
const rows = JSON.parse('[{"a":1,"id":0},{"b":2,"id":1},{"c":3,"id":2},{"a":4,"b":5,"id":3},{"a":5,"c":6,"id":4},{"b":6,"a":7,"id":5},{"b":7,"c":8,"id":6},{"c":8,"a":9,"id":7},{"c":9,"b":10,"id":8},{"a":10,"b":11,"c":12,"id":9},{"a":11,"c":12,"b":13,"id":10},{"b":12,"a":13,"c":14,"id":11},{"b":13,"c":14,"a":15,"id":12},{"c":14,"a":15,"b":16,"id":13},{"c":15,"b":16,"a":17,"id":14}]');
for (const row of rows) sum += (row.a ?? 0) * 3 + (row.b ?? 0) * 5 + (row.c ?? 0) * 7 + row.id + Object.keys(row).join("").length;
console.log(sum);
