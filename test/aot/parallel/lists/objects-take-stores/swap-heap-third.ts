export {};
interface Box { v: number; s: number }

class Below<T> extends Array<T> {}
function contents(): any {
  const boxes = (n: number): any => Array.from({ length: n }, (_, i) => ({ v: (i * 37) % 11, s: i }));
  const holes = boxes(9); delete holes[3]; delete holes[7];
  const named = boxes(7); named.note = "x"; named["-1"] = { v: 99, s: 98 };
  const accessor = boxes(6); Object.defineProperty(accessor, 2, { get() { return { v: 5, s: 50 }; }, set(x: any) { log.push("set " + (x && x.v)); }, configurable: true, enumerable: true });
  const sparse = boxes(4); sparse[5000] = { v: 1, s: 77 };
  const mixed = [{ v: 3, s: 0 }, null, { v: 1, s: 2 }, undefined, { v: 2, s: 4 }];
  return { boxes: boxes(12), one: boxes(1), none: [], holes, named, accessor, sparse, mixed, frozen: Object.freeze(boxes(5)), sealed: Object.seal(boxes(5)), below: Below.from(boxes(8)), strings: ["b", "a", "d", "c"], numbers: [5, 3, 9, 1], doubles: [5.5, 3.25, -0, 1], two: [boxes(3), boxes(2)] };
}
const log: string[] = [];
function show(x: any): string { return x === null || typeof x !== "object" ? (Object.is(x, -0) ? "-0" : String(x)) : Array.isArray(x) ? "[" + x.length + "]" : x.v + ":" + x.s; }
function tell(list: any): string { let s = list.length + " "; for (let i = -1; i < Math.min(list.length, 14); i++) s += (i in list ? show(list[i]) : "_") + ","; return s; }

function less(a: any, b: any) { return a && b && a.v < b.v; }
function walk(list: Box[]) {
  let n = 0;
  for (let i = 0, t = 0; t < 20; t++) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < list.length && less(list[l], list[m])) m = l; if (r < list.length && less(list[r], list[m])) m = r; if (m === i) break;
    const x = list[m]; list[m] = list[i]; list[i] = list[0]; list[0] = x;
  i = m; }
  return n;
}
for (let round = 0; round < 2; round++) for (const [name, list] of Object.entries(contents())) {
  let said: any;
  try { said = walk(list as any); } catch (e) { said = (e as any).constructor.name; }
  console.log(name, said, tell(list), log.splice(0).join(" "));
}
