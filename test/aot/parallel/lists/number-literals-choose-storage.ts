// Literals written to hold numbers whose elements nobody has proven numbers. The elements choose the storage, and later stores convert it.
const sources: [string, any[]][] = [
  ["integers", [1, 2, 3, 4, 5, 6, 7, 8, 9]], ["borders", [2147483647, -2147483648, 0, -1, 1, 2147483647, 5, 6, 7]], ["wide", [1, 2147483648, 3, -2147483649, 5, 1e15, 7, 8, 9]],
  ["halves", [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5]], ["mixed", [1, 2, 3, 4.5, 5, 6, 7, 8, 9]], ["zeros", [0, -0, 1, -0, 2, 3, 4, 5, 6]], ["numbers", [NaN, 1, Infinity, 2, 3, -Infinity, 4, 5, 6]],
  ["texts", [1, 2, "t", 4, 5, 6, "u", 8, 9]], ["empty", [1, undefined, 3, null, 5, 6, 7, 8, true]], ["objects", [1, [2], { valueOf: () => 3 }, 4, 5, 6, 7, 8, 9]],
];
function show(v: any): string {
  if (Array.isArray(v)) return "[" + Array.from(v, (x, i) => i in v ? show(x) : "_").join() + "]";
  return Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : v !== null && typeof v === "object" ? "{}" : String(v);
}
function pair(a: number, b: number): number[] { return [a, b]; }
function half(list: number[]) { list[0] = list[0]! + 0.5; }
const births: [string, (v: any[], k: number) => number[]][] = [
  ["one", (v, k): number[] => [v[k]]], ["two", (v, k): number[] => [v[k], v[k + 1]]], ["three", (v, k): number[] => [v[k], k, v[k + 2]]], ["four", (v, k): number[] => [v[0], v[k], v[1], v[2]]],
  ["five", (v, k): number[] => [v[0], v[1], v[2], v[3], v[k]]], ["nine", (v, k): number[] => [v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[k]]], ["parameters", (v, k) => pair(v[k], v[k + 1])],
  ["seventeen", (v, k): number[] => [v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[k]]], ["negated", (v, k): number[] => [v[k], -v[k]]], ["spread", (v, k): number[] => [...[v[k], v[k + 1]], v[0]]],
];
const stores: [string, (list: any) => void][] = [
  ["nothing", () => {}], ["half", list => { list[0] = 0.5; }], ["minus zero", list => { list[0] = -0; }], ["NaN", list => { list[0] = NaN; }], ["text", list => { list[0] = "t"; }], ["undefined", list => { list[0] = undefined; }], ["push", list => { list.push(2.5); }],
  ["text pushed", list => { list.push("p"); }], ["shorter", list => { list.length = 1; }], ["longer", list => { list[20] = 4; }], ["added", list => { half(list); }], ["wide", list => { list[0] = 4294967296; }], ["frozen", list => { Object.freeze(list); }],
  ["deleted", list => { delete list[0]; }], ["sorted", list => { list.sort(); }], ["filled", list => { list.fill(1.5); }], ["spliced", list => { list.splice(0, 1, 7, 8.5); }],
];
function total(list: number[]) { let s = 0; for (let i = 0; i < list.length; i++) s = (s + list[i]!) | 0; return s; }
function sum(list: number[]) { let s: any = 0; for (const x of list) s += x; return s; }
function first(list: number[]) { const [a, b] = list; return (a! - b!) | 0; }
let digest = 0;
for (const [source, values] of sources) {
  const lines: string[] = [];
  for (const [birth, make] of births) {
    for (const [store, change] of stores) {
      // The site of a literal remembers the storage that its arrays were converted to.
      for (let round = 0; round < 70; round += 23) {
        const lists: number[][] = [];
        for (let k = 0; k < 7; k++) lists.push(make(values, k));
        const out: string[] = [];
        const go = () => { for (const read of [total, sum, first]) { try { out.push(show(lists.map(read))); } catch (e: any) { out.push(e.constructor.name); } } };
        go();
        try { for (const list of lists) change(list); } catch (e: any) { out.push(e.constructor.name); }
        go();
        lines.push(birth + " " + store + " " + out.join(" ") + " " + show(lists));
      }
    }
  }
  const text = lines.join("\n");
  for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0;
  console.log(source, lines.length, digest, "|", lines[8]!.slice(0, 160));
}
