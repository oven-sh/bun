// Seven names in thousands of orders, each beside a name that its record asks for and the rows lack: none fits, and each shape is remembered while it lives. They are dropped and collected.
// Then rows that do fit come in hundreds of orders of their own. Their shapes are new, and may lie where a dead one lay: every one of them is made a record.
// COUNTER: ObjectsParsedIntoRecords >= 700
// Env of the executable: BUN_JSC_verifyGC=1
interface Needy { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number; g?: number; needed: number }
interface Easy { p?: number; q?: number; r?: number; s?: number; t?: number; u?: number }
function order(names: string[], index: number): string[] { const left = names.slice(), out: string[] = []; for (let n = left.length; n > 0; n--) { out.push(left.splice(index % n, 1)[0]!); index = Math.floor(index / n); } return out; }
function row(names: string[], index: number): string { return "{" + order(names, index).map((name, place) => '"' + name + '":' + (index + place)).join() + "}"; }
const needy: Needy[] = JSON.parse('[{"a":1,"needed":2}]'), easy: Easy[] = JSON.parse('[{"p":1,"q":2}]');
let sum = needy[0]!.needed + easy[0]!.p!;
for (let round = 0; round < 3; round++) {
  let dropped: any[] | null = [];
  for (let index = 0; index < 3000; index++) dropped.push(JSON.parse(row(["a", "b", "c", "d", "e", "f", "g"], index + round * 1000)));
  sum += dropped.length + dropped[7].a;
  dropped = null;
  Bun.gc(true);
  const kept: Easy[] = [];
  for (let index = 0; index < 240; index++) kept.push(JSON.parse(row(["p", "q", "r", "s", "t", "u"], index + round * 240)) as Easy);
  for (const each of kept) sum += each.p! + each.u!;
}
console.log(sum);
