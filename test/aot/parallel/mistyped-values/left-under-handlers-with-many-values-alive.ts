// Guesses that fail under handlers with more values than registers take: what is thrown behind them, what is thrown where they fail, finally blocks.
function openTheWorld(): unknown { return eval("1"); }
type Host = { a: number; s: string; log: (x: number) => void };
let seen = 0, calls = 0, breakAt = 0, throwAt = 0;
const host: any = { a: 1, s: "s", log(x: number) { seen += x; ++calls; if (calls === breakAt) host.a = "one"; if (calls === throwAt) throw new Error("thrown at " + calls); } };
function fresh(at: number, thrown: number) { host.a = 1; calls = 0; breakAt = at; throwAt = thrown; }
export function guarded(h: Host, p0: string, p1: number, p2: string, p3: number, p4: string, p5: number, p6: string, p7: number) {
  let r = 0, where = "start", half = 0.5;
  try {
    h.log(1); r += h.a; where = "one"; half += h.a;
    try {
      h.log(2); r += h.a; where = "two"; half += h.a;
      h.log(3); r += h.a; where = "three";
    } catch (inner) {
      where += " inner:" + (inner as Error).message;
      h.log(4); r += h.a;
    } finally {
      where += " finally";
      h.log(5); r += h.a; half += h.a;
    }
    h.log(6); r += h.a; where += " six";
  } catch (outer) {
    where += " outer:" + (outer as Error).message;
  }
  return [r, where, half, p0, p1, p2, p3, p4, p5, p6, p7].join(" ");
}
export function deep(h: Host, depth: number, p0: string, p1: number, p2: string, p3: number, p4: string, p5: number, p6: number): string {
  let r = 0, label = p0 + depth;
  try {
    h.log(1); r += h.a;
    if (depth > 0) label += deep(h, depth - 1, p0, p1, p2, p3, p4, p5, p6).length;
    h.log(2); r += h.a;
  } catch (error) {
    label += "!" + (error instanceof RangeError ? "range" : (error as Error).message);
  }
  return label + r + p1 + p2 + p3 + p4 + p5 + p6;
}
openTheWorld();
Object.assign(globalThis as any, { guarded, deep });
for (let at = 0; at < 8; at++) for (let thrown = 0; thrown < 8; thrown++) {
  fresh(at, thrown); console.log(at, thrown, guarded(host, "P", 1.5, "Q", 2, "R", -0, "S", 4e15), seen);
  fresh(at, thrown); console.log(at, thrown, deep(host, 3, "P", 1.5, "Q", 2, "R", -0, 7), seen);
}
fresh(3, 0); console.log(deep(host, 200000, "P", 1.5, "Q", 2, "R", -0, 7).length > 0);
