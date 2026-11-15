// Members of a Set and keys of a Map are deleted in runs of every length from 0 to 40, beginning at every place from 0 to 9, and what is left is read in six ways.
// Whoever walks the table passes a run by in steps of several entries: no live member behind, between or at the end of a run may be passed by, and none may be seen twice.
// The members are numbers (kept as whole words), texts (kept as half words), and both beside true, null and undefined. All the work stands in functions.
declare const process: any; export {};
type Kind = "numbers" | "texts" | "mixed";
function member(kind: Kind, i: number): unknown { return kind === "numbers" ? i * 3 : kind === "texts" ? "m" + i : i % 7 === 3 ? [true, null, undefined, false][(i >> 3) & 3] : i & 1 ? "t" + i : i + 0.5; }
function told(list: unknown[]): string { let s = ""; for (let i = 0; i < list.length; i++) s += String(list[i]) + ","; let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000003; return list.length + ":" + h; }
function made(kind: Kind, size: number, runs: [number, number][]): { set: Set<unknown>; map: Map<unknown, unknown>; left: unknown[] } {
  const set = new Set<unknown>(), map = new Map<unknown, unknown>(), all: unknown[] = [];
  for (let i = 0; i < size; i++) { const m = member(kind, i); if (!set.has(m)) all.push(m); set.add(m); map.set(m, i); }
  const gone = new Array<boolean>(all.length).fill(false);
  for (const [from, length] of runs) for (let i = from; i < from + length && i < all.length; i++) { gone[i] = true; set.delete(all[i]); map.delete(all[i]); }
  const left: unknown[] = []; for (let i = 0; i < all.length; i++) if (!gone[i]) left.push(all[i]);
  return { set, map, left };
}
function byHand(it: Iterator<unknown>): unknown[] { const out: unknown[] = []; for (let step = it.next(); !step.done; step = it.next()) out.push(step.value); return out; }
function byLoop(it: Iterable<unknown>): unknown[] { const out: unknown[] = []; for (const m of it) out.push(m); return out; }
function byCallback(set: Set<unknown>): unknown[] { const out: unknown[] = []; set.forEach(m => { out.push(m); }); return out; }
function byPattern(it: Iterable<unknown>): unknown[] { const [a, b, c, ...rest] = it; return rest.length || c !== undefined ? [a, b, c, ...rest] : [a, b, c]; }
function ways(kind: Kind, size: number, runs: [number, number][]): string {
  const { set, map, left } = made(kind, size, runs), want = told(left);
  const got = [told(byHand(set.values())), told(byLoop(set)), told([...set]), told(byCallback(set)), told(Array.from(map.keys())), told(byHand(map.keys())), told(byLoop(map.keys()))];
  const first = byPattern(set).slice(0, left.length), pairs = byLoop(map) as [unknown, unknown][];
  let ok = told(first) === told(left.slice(0, first.length)) && pairs.length === left.length && set.size === left.length;
  for (let i = 0; i < pairs.length; i++) ok = ok && Object.is(pairs[i]![0], left[i]);
  for (const g of got) ok = ok && g === want;
  return ok ? want : "WRONG " + want + " | " + got.join(" ");
}
function main(): void {
  for (const kind of ["numbers", "texts", "mixed"] as Kind[]) {
    for (let from = 0; from < 10; from++) { let line = kind + " from " + from + ":"; for (let length = 0; length <= 40; length++) line += " " + ways(kind, 64, [[from, length]]); console.log(line); }
    for (const runs of [[[1, 7], [9, 8], [18, 9], [28, 31]], [[0, 33], [34, 29]], [[0, 64]], [[1, 62]], [[0, 63]], [[2, 4], [7, 4], [12, 4], [17, 40]], [[5, 32], [38, 1], [40, 24]]] as [number, number][][]) console.log(kind, JSON.stringify(runs), ways(kind, 64, runs), ways(kind, 200, runs), ways(kind, 9, runs));
  }
  const grows = new Set<number>(); for (let i = 0; i < 50; i++) grows.add(i); for (let i = 1; i < 45; i++) grows.delete(i);
  const seen: number[] = []; for (const m of grows) { seen.push(m); if (m === 0) { grows.add(100); grows.delete(46); } if (m === 47) grows.add(101); } console.log("changed under the walk", seen.join());
  const held = new Set<number>(); for (let i = 0; i < 40; i++) held.add(i); const it = held.values(); it.next(); it.next(); for (let i = 1; i < 39; i++) held.delete(i); console.log("a place held in a run", byHand(it).join(), [...held].join());
}
main();
