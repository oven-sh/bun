// STATISTIC: CarriedIndexGuardsHoisted >= 1
// Indexes that a loop takes from the lists it reads: union-find, lists linked by index, jumps of a bytecode machine; over every kind of list, past its ends, fractions, -0, NaN, names.
let log = "";
function show(...values: any[]): void { for (const v of values) log += (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : String(v)) + ","; log += ";"; }
const parse = (text: string): any => JSON.parse(text);
const int32s = (): number[] => parse("[0,0,1,2,3,4,5,6,7,8,9,10]");
const doubles = (): number[] => parse("[0,0,1,2,3,4,5,6,7,8,9,10,0.5]");
const contiguous = (): number[] => { const a: any[] = int32s(); a.push("t"); a.pop(); return a; };
const holes = (): number[] => { const a = int32s(); delete a[2]; return a; };
const negative = (): number[] => parse("[0,0,1,2,-0.0,4,5,6,7,8,9,10]");
const outside = (): number[] => parse("[0,0,1,2,99,4,5,6,7,8,9,10]");
const below = (): number[] => parse("[0,0,1,2,-1,4,5,6,7,8,9,10]");
const fraction = (): number[] => parse("[0,0,1,2,3,2.5,5,6,7,8,9,10]");
const wide = (): number[] => parse("[0,0,1,2,3,4294967296,5,6,7,8,9,10]");
const named = (): number[] => { const a: any = below(); a[-1] = 3; a["2.5"] = 1; a[4294967296] = 2; return a; };
const other = (): number[] => parse('[0,0,1,2,"3",4,null,6,true,8,9,10]');
const lists = [int32s, doubles, contiguous, holes, negative, outside, below, fraction, wide, named, other];
function find(parent: number[], x: number): number {
  let turns = 0;
  while (parent[x] !== x) {
    parent[x] = parent[parent[x]];
    x = parent[x];
    if (++turns > 30) return -7;
  }
  return x;
}
function root(parent: number[], x: number): number { let turns = 0; while (parent[x] !== x && turns++ < 20) x = parent[x]; return x; }
function rootWithoutSteps(parent: number[], x: number): number { while (x > 0) x = parent[x]; return x; }
function walkLinked(next: number[], values: number[], head: number): string { let text = ""; let turns = 0; for (let e = head; e !== -1 && e !== undefined; e = next[e]) { text += values[e] + "|"; if (++turns > 20) break; } return text; }
function walkFromZero(next: number[], values: number[]): number { let total = 0, turns = 0; let e = 0; do { total = total * 3 + (values[e] || 1); e = next[e]; turns++; } while (e !== 0 && turns < 12); return total; }
function run(code: number[], limit: number): string {
  let pc = 0, value = 1, turns = 0, text = "";
  while (pc < code.length && turns++ < limit) {
    switch (code[pc++]) {
      case 0: value = value * 2 + 1; break;
      case 1: value -= code[pc++]; break;
      case 2: pc = code[pc]; break;
      case 3: if (value % 3 === 0) pc = code[pc]; else pc++; break;
      case 4: text += value + " "; break;
      case 5: return text + "end" + value;
      default: text += "?"; break;
    }
    if (value > 1e9) value = 7;
  }
  return text + pc + "/" + value;
}
function changing(next: number[], x: number, at: number): string {
  let text = "";
  for (let turns = 0; turns < 9; turns++) {
    const before = next[x];
    if (turns === at) { (next as any)[1] = "s"; }
    if (turns === at + 1) next.length = 3;
    const after = next[x];
    text += before + ":" + after + "|";
    x = next[x];
  }
  return text;
}
function growing(next: number[], x: number): string { let text = ""; for (let turns = 0; turns < 6; turns++) { next.push(turns + 0.5); x = next[next.length - 1 - turns] | 0; text += next[x] + "|"; x = next[x]; } return text; }
function twoLists(a: number[], b: number[], x: number): string { let text = ""; for (let turns = 0; turns < 8; turns++) { x = turns & 1 ? a[x] : b[x]; text += x + "|"; } return text; }
function inner(heads: number[], next: number[], values: number[]): number { let total = 0; for (let u = 0; u < heads.length; u++) { let turns = 0; for (let e = heads[u]; e !== -1 && turns++ < 15; e = next[e]) total += values[e] ?? 5; } return total; }
for (let round = 0; round < 3; round++) {
  for (const make of lists) {
    for (const x of [0, 1, 5, 11, 12, 40, -1, 2.5, -0, NaN, 4294967296, "3" as any, undefined as any, null as any]) {
      show(find(make(), x), root(make(), x), rootWithoutSteps(make(), x), walkLinked(make(), int32s(), x), walkLinked(make(), make(), x), changing(make(), x, 2), changing(make(), x, 0), twoLists(make(), int32s(), x), twoLists(doubles(), make(), x));
      const parent = make(); find(parent, x); find(parent, 11); show(parent, Object.keys(parent).length);
    }
    show(walkFromZero(make(), doubles()), growing(make(), 3), inner(make(), int32s(), make()), inner(int32s(), make(), doubles()));
  }
  for (const code of ["[0,4,0,4,2,0]", "[0,0,3,7,4,2,0,1,5,4,2,2]", "[0,4,2,99]", "[0,4,2,-1]", "[0,4,2,1.5]", "[0,4,2,-0.0,5]", "[0,1,0.5,4,2,0]", '[0,4,2,"1",5]', "[0,4,2,null,5]", "[6,0,4,5]", "[2,4294967296,0]", "[2]"]) show(run(parse(code), 60));
}
let state = 7, check = 0;
for (let i = 0; i < 200; i++) {
  const size = 5 + (i % 40);
  const parent: number[] = [];
  for (let k = 0; k < size; k++) parent.push(k);
  for (let k = 0; k < size; k++) { state = (state * 16807) % 2147483647; const a = find(parent, k), b = find(parent, state % size); if (a !== b) parent[a] = b; else check++; }
  check = (check * 31 + root(parent, size - 1)) % 1000003;
}
show(check);
console.log(log.length, log);
