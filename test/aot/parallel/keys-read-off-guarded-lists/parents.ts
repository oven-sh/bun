// x = list[x] in a small function that a loop calls, and a switch over the elements of a list that a loop around has tested: the inner loop asks the list for int32s once more.
function shown(x: any): string { return Array.isArray(x) || ArrayBuffer.isView(x) ? `[${Array.from({ length: Math.min((x as any).length, 10) }, (_, i) => (i in (x as any) ? shown((x as any)[i]) : "hole")).join(",")}]` : typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "object" && x !== null ? "object" : `${typeof x}:${String(x)}`; }
const late = process.argv.length > 99 ? 1 : 0;
function veil(x: any): any { const all: any[][] = [[x], [0]]; return all[late]![0]; }

function find(p: number[], x: number): any { let n = 0; while (p[x] !== x && n < 20) { x = p[x]!; n++; } return x; }
function halve(p: number[], x: number): any { let n = 0; while (p[x] !== x && n < 20) { p[x] = p[p[x]!]!; x = p[x]!; n++; } return x; }
function twoPass(p: number[], x: number): any { let r = x, n = 0; while (p[r] !== r && n < 20) { r = p[r]!; n++; } while (p[x] !== r && n < 40) { const next = p[x]!; p[x] = r; x = next; n++; } return r; }
function chase(p: number[], x: number): any { let n = 0; for (let k = 0; k < 4; k++) { x = p[x]!; n += x; } return n; }
function cycle(p: number[], x: number): any { let n = 0; const s = x; do { x = p[x]!; n++; } while (x !== s && n < 9); return n; }
function machine(p: number[], x: number): any { let t = 0; for (let i = 0; i < p.length; i++) switch (p[i]) { case 0: t++; break; case 1: t += 2; break; case 2: t = t * 3 % 1009; break; case 3: t ^= x; break; default: t += 7; } return t; }
function pushed(p: number[], x: number): any { const out: number[] = []; for (let i = 0; i < p.length; i++) out.push(p[i]! + x); return out.length + (out[2] ?? 0); }
function run(work: any, p: number[]): any { let t: any = 0; for (let i = 0; i < 10; i++) t += work(p, i); return t; }
function runFind(p: number[]): any { let t: any = 0; for (let i = 9; i >= 0; i--) t += find(p, i); return t; }
function runHalve(p: number[]): any { let t: any = 0; for (let i = 9; i >= 0; i--) t += halve(p, i); return t; }
function runTwoPass(p: number[]): any { let t: any = 0; for (let i = 9; i >= 0; i--) t += twoPass(p, i); return t; }
function runChase(p: number[]): any { let t: any = 0; for (let i = 0; i < 10; i++) t += chase(p, i); return t; }
function runCycle(p: number[]): any { let t: any = 0; for (let i = 0; i < 10; i++) t += cycle(p, i); return t; }
function runMachine(p: number[]): any { let t: any = 0; for (let i = 0; i < 10; i++) t += machine(p, i); return t; }
function runPushed(p: number[]): any { let t: any = 0; for (let i = 0; i < 10; i++) t += pushed(p, i); return t; }

const lists: (() => any)[] = [
  () => Array.from({ length: 10 }, (_, i) => i % 4 ? i - 1 : i),
  () => JSON.parse("[0,0,1,2,4,4,5,6,8,8]"),
  () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 0],
  () => [0.5, 0, 1, 2, 4, 4, 5, 6, 8, 8],
  () => [0, 0.5, 1, 2, 4, 4, 5, 6, 8, 8],
  () => [0, , 1, 2, 4, 4, , 6, 8, 8],
  () => [0, -1, 1, 2, 4, 4, 5, 6, 8, 8],
  () => [0, -0, 1, 2, 4, 4, 5, NaN, 8, 8],
  () => [0, 100, 1, 2, 4, 4, 5, 6, 8, 4294967296],
  () => [0, "0", 1, "2", 4, 4, 5, 6, 8, 8],
  () => ["length", 0, 1, 2, 4, 4, 5, 6, 8, 8],
  () => Object.freeze([0, 0, 1, 2, 4, 4, 5, 6, 8, 8]),
  () => Int32Array.of(0, 0, 1, 2, 4, 4, 5, 6, 8, 8),
  () => Float64Array.of(0, 0, 1, 2, 4, 4, 5, 6, 8, 8.5),
  () => [0, 0, 1],
  () => [],
  () => new (class Own extends Array<number> {})(0, 0, 1, 2, 4, 4, 5, 6, 8, 8),
];
for (const each of [runFind, runHalve, runTwoPass, runChase, runCycle, runMachine, runPushed, (p: number[]) => run(find, p), (p: number[]) => run(machine, p)]) {
  const lines: string[] = [];
  for (const make of lists) {
    const list = veil(make());
    let answer: string;
    try { answer = shown(each(list)); } catch (e: any) { answer = e.constructor.name; }
    lines.push(answer + shown(list));
  }
  console.log(each.name, lines.join(" "));
}
export {};
