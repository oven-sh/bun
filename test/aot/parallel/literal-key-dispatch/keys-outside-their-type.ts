// STATISTIC: AccessesDispatchedByKeyString >= 1
type Axis = "x" | "y" | "z";
interface Point { x: number; y: number; z: number }
const axes: Axis[] = ["x", "y", "z"];
function order(points: Point[], at: number): string {
  const axis = axes[at]!;
  return points.slice().sort((a, b) => a[axis] - b[axis]).map(point => JSON.stringify(point)).join(" ");
}
const points: Point[] = [{ x: 3, y: 1.5, z: -0 }, { x: 1, y: 2.5, z: 0 }, { x: 2, y: 0.5, z: NaN }];
const out: unknown[] = [];
for (let round = 0; round < 20; round++) out.push(order(points, 0), order(points, 1), order(points, 2));
const log: string[] = [];
const odd: any[] = [{ get x() { log.push("get"); return 2; }, y: 1 }, new Proxy({ x: 1, y: 2 }, { get: (o: any, k) => (log.push(String(k)), o[k]) }), Object.create({ x: 0, y: 3 })];
for (const key of ["x", "y", "toString", 7, Symbol.iterator, { toString: () => (log.push("key"), "x") }, undefined, null]) {
  (axes as unknown[])[3] = key;
  try { out.push(odd.slice().sort((a, b) => a[axes[3]!] - b[axes[3]!]).map((_, i) => i).join(), order(points, 3)); } catch (error) { out.push((error as Error).name); }
}
out.push(order(points, 9));
console.log(out.slice(-18).join("\n"), log.join());
