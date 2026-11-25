// Twelve records have `a` and `id`, and each asks for a name of its own beside them. The rows below have `a` and `id` alone: every record has both names and none fits.
// One such row is kept, so their shape lives through every collection, and the parser tries the twelve once: what it found is remembered for as long as the shape lives.
// COUNTER: RecordPlanChoices <= 16
// COUNTER: ObjectsParsedIntoOrdinaryObjects >= 80
// Env of the executable: BUN_JSC_verifyGC=1
interface Kind0 { a: number; id: number; own0: number }
interface Kind1 { a: number; id: number; own1: number }
interface Kind2 { a: number; id: number; own2: number }
interface Kind3 { a: number; id: number; own3: number }
interface Kind4 { a: number; id: number; own4: number }
interface Kind5 { a: number; id: number; own5: number }
interface Kind6 { a: number; id: number; own6: number }
interface Kind7 { a: number; id: number; own7: number }
interface Kind8 { a: number; id: number; own8: number }
interface Kind9 { a: number; id: number; own9: number }
interface Kind10 { a: number; id: number; own10: number }
interface Kind11 { a: number; id: number; own11: number }
const kind0: Kind0[] = JSON.parse('[{"a":1,"own0":0,"id":2}]');
const kind1: Kind1[] = JSON.parse('[{"a":1,"own1":1,"id":2}]');
const kind2: Kind2[] = JSON.parse('[{"a":1,"own2":2,"id":2}]');
const kind3: Kind3[] = JSON.parse('[{"a":1,"own3":3,"id":2}]');
const kind4: Kind4[] = JSON.parse('[{"a":1,"own4":4,"id":2}]');
const kind5: Kind5[] = JSON.parse('[{"a":1,"own5":5,"id":2}]');
const kind6: Kind6[] = JSON.parse('[{"a":1,"own6":6,"id":2}]');
const kind7: Kind7[] = JSON.parse('[{"a":1,"own7":7,"id":2}]');
const kind8: Kind8[] = JSON.parse('[{"a":1,"own8":8,"id":2}]');
const kind9: Kind9[] = JSON.parse('[{"a":1,"own9":9,"id":2}]');
const kind10: Kind10[] = JSON.parse('[{"a":1,"own10":10,"id":2}]');
const kind11: Kind11[] = JSON.parse('[{"a":1,"own11":11,"id":2}]');
let sum = kind0[0]!.own0 + kind1[0]!.own1 + kind2[0]!.own2 + kind3[0]!.own3 + kind4[0]!.own4 + kind5[0]!.own5 + kind6[0]!.own6 + kind7[0]!.own7 + kind8[0]!.own8 + kind9[0]!.own9 + kind10[0]!.own10 + kind11[0]!.own11;
const kept = JSON.parse('[{"a":5,"id":6}]');
for (let turn = 0; turn < 40; turn++) {
  const rows = JSON.parse('[{"a":' + turn + ',"id":7},{"a":1,"id":8}]');
  sum += rows[0].a + rows[1].id;
  Bun.gc(true);
}
console.log(sum + kept[0].a + kept[0].id);
