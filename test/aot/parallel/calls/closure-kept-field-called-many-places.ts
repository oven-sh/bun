// A closure kept in a field is called at many places and the stack is read inside.
// Flags: --aot-heat=everything-is-cold
type Holder = { f: (a: number) => number; next: Holder | null };
let g0 = 1, g1 = 2, g2 = 3, g3 = 4, g4 = 5, g5 = 6, g6 = 7, g7 = 8;
const traces: string[] = [];
function shorten(lines: string[]): string {
  return lines.map(line => line.trim().replace(/\(.*[\\/]/, "(")).join(" | ");
}
function note(): void {
  traces.push(shorten((new Error("here").stack ?? "").split("\n").slice(1, 4)));
}
function first(k: number, j: number, m: number): (a: number) => number {
  return (a: number): number => { if (g7 > 1000000) { g0 = ((g3 + 1) ^ g5) | 0; g1 = ((g4 + 8) ^ g6) | 0; g2 = ((g5 + 15) ^ g7) | 0; g3 = ((g6 + 22) ^ g0) | 0; g4 = ((g7 + 29) ^ g1) | 0; g5 = ((g0 + 36) ^ g2) | 0; g6 = ((g1 + 43) ^ g3) | 0; g7 = ((g2 + 50) ^ g4) | 0; g0 = ((g3 + 57) ^ g5) | 0; g1 = ((g4 + 64) ^ g6) | 0; g2 = ((g5 + 71) ^ g7) | 0; g3 = ((g6 + 78) ^ g0) | 0; g4 = ((g7 + 85) ^ g1) | 0; g5 = ((g0 + 92) ^ g2) | 0; g6 = ((g1 + 99) ^ g3) | 0; g7 = ((g2 + 106) ^ g4) | 0; g0 = ((g3 + 113) ^ g5) | 0; g1 = ((g4 + 120) ^ g6) | 0; g2 = ((g5 + 127) ^ g7) | 0; g3 = ((g6 + 134) ^ g0) | 0; g4 = ((g7 + 141) ^ g1) | 0; g5 = ((g0 + 148) ^ g2) | 0; g6 = ((g1 + 155) ^ g3) | 0; g7 = ((g2 + 162) ^ g4) | 0; g0 = ((g3 + 169) ^ g5) | 0; g1 = ((g4 + 176) ^ g6) | 0; g2 = ((g5 + 183) ^ g7) | 0; g3 = ((g6 + 190) ^ g0) | 0; g4 = ((g7 + 197) ^ g1) | 0; g5 = ((g0 + 204) ^ g2) | 0; g6 = ((g1 + 211) ^ g3) | 0; g7 = ((g2 + 218) ^ g4) | 0; g0 = ((g3 + 225) ^ g5) | 0; g1 = ((g4 + 232) ^ g6) | 0; g2 = ((g5 + 239) ^ g7) | 0; g3 = ((g6 + 246) ^ g0) | 0; g4 = ((g7 + 253) ^ g1) | 0; g5 = ((g0 + 260) ^ g2) | 0; g6 = ((g1 + 267) ^ g3) | 0; g7 = ((g2 + 274) ^ g4) | 0; g0 = ((g3 + 281) ^ g5) | 0; g1 = ((g4 + 288) ^ g6) | 0; g2 = ((g5 + 295) ^ g7) | 0; g3 = ((g6 + 302) ^ g0) | 0; g4 = ((g7 + 309) ^ g1) | 0; g5 = ((g0 + 316) ^ g2) | 0; g6 = ((g1 + 323) ^ g3) | 0; g7 = ((g2 + 330) ^ g4) | 0; } if ((a & 15) === 7) note(); return (a + k + j - m) | 0; };
}
function second(k: number, j: number, m: number): (a: number) => number {
  return (a: number): number => { if (g7 > 1000000) { g0 = ((g3 + 1) ^ g5) | 0; g1 = ((g4 + 8) ^ g6) | 0; g2 = ((g5 + 15) ^ g7) | 0; g3 = ((g6 + 22) ^ g0) | 0; g4 = ((g7 + 29) ^ g1) | 0; g5 = ((g0 + 36) ^ g2) | 0; g6 = ((g1 + 43) ^ g3) | 0; g7 = ((g2 + 50) ^ g4) | 0; g0 = ((g3 + 57) ^ g5) | 0; g1 = ((g4 + 64) ^ g6) | 0; g2 = ((g5 + 71) ^ g7) | 0; g3 = ((g6 + 78) ^ g0) | 0; g4 = ((g7 + 85) ^ g1) | 0; g5 = ((g0 + 92) ^ g2) | 0; g6 = ((g1 + 99) ^ g3) | 0; g7 = ((g2 + 106) ^ g4) | 0; g0 = ((g3 + 113) ^ g5) | 0; g1 = ((g4 + 120) ^ g6) | 0; g2 = ((g5 + 127) ^ g7) | 0; g3 = ((g6 + 134) ^ g0) | 0; g4 = ((g7 + 141) ^ g1) | 0; g5 = ((g0 + 148) ^ g2) | 0; g6 = ((g1 + 155) ^ g3) | 0; g7 = ((g2 + 162) ^ g4) | 0; g0 = ((g3 + 169) ^ g5) | 0; g1 = ((g4 + 176) ^ g6) | 0; g2 = ((g5 + 183) ^ g7) | 0; g3 = ((g6 + 190) ^ g0) | 0; g4 = ((g7 + 197) ^ g1) | 0; g5 = ((g0 + 204) ^ g2) | 0; g6 = ((g1 + 211) ^ g3) | 0; g7 = ((g2 + 218) ^ g4) | 0; g0 = ((g3 + 225) ^ g5) | 0; g1 = ((g4 + 232) ^ g6) | 0; g2 = ((g5 + 239) ^ g7) | 0; g3 = ((g6 + 246) ^ g0) | 0; g4 = ((g7 + 253) ^ g1) | 0; g5 = ((g0 + 260) ^ g2) | 0; g6 = ((g1 + 267) ^ g3) | 0; g7 = ((g2 + 274) ^ g4) | 0; g0 = ((g3 + 281) ^ g5) | 0; g1 = ((g4 + 288) ^ g6) | 0; g2 = ((g5 + 295) ^ g7) | 0; g3 = ((g6 + 302) ^ g0) | 0; g4 = ((g7 + 309) ^ g1) | 0; g5 = ((g0 + 316) ^ g2) | 0; g6 = ((g1 + 323) ^ g3) | 0; g7 = ((g2 + 330) ^ g4) | 0; } if ((a & 15) === 9) note(); return (a + k + 1 + j - m) | 0; };
}
function third(k: number, j: number, m: number): (a: number) => number {
  return (a: number): number => { if (g7 > 1000000) { g0 = ((g3 + 1) ^ g5) | 0; g1 = ((g4 + 8) ^ g6) | 0; g2 = ((g5 + 15) ^ g7) | 0; g3 = ((g6 + 22) ^ g0) | 0; g4 = ((g7 + 29) ^ g1) | 0; g5 = ((g0 + 36) ^ g2) | 0; g6 = ((g1 + 43) ^ g3) | 0; g7 = ((g2 + 50) ^ g4) | 0; g0 = ((g3 + 57) ^ g5) | 0; g1 = ((g4 + 64) ^ g6) | 0; g2 = ((g5 + 71) ^ g7) | 0; g3 = ((g6 + 78) ^ g0) | 0; g4 = ((g7 + 85) ^ g1) | 0; g5 = ((g0 + 92) ^ g2) | 0; g6 = ((g1 + 99) ^ g3) | 0; g7 = ((g2 + 106) ^ g4) | 0; g0 = ((g3 + 113) ^ g5) | 0; g1 = ((g4 + 120) ^ g6) | 0; g2 = ((g5 + 127) ^ g7) | 0; g3 = ((g6 + 134) ^ g0) | 0; g4 = ((g7 + 141) ^ g1) | 0; g5 = ((g0 + 148) ^ g2) | 0; g6 = ((g1 + 155) ^ g3) | 0; g7 = ((g2 + 162) ^ g4) | 0; g0 = ((g3 + 169) ^ g5) | 0; g1 = ((g4 + 176) ^ g6) | 0; g2 = ((g5 + 183) ^ g7) | 0; g3 = ((g6 + 190) ^ g0) | 0; g4 = ((g7 + 197) ^ g1) | 0; g5 = ((g0 + 204) ^ g2) | 0; g6 = ((g1 + 211) ^ g3) | 0; g7 = ((g2 + 218) ^ g4) | 0; g0 = ((g3 + 225) ^ g5) | 0; g1 = ((g4 + 232) ^ g6) | 0; g2 = ((g5 + 239) ^ g7) | 0; g3 = ((g6 + 246) ^ g0) | 0; g4 = ((g7 + 253) ^ g1) | 0; g5 = ((g0 + 260) ^ g2) | 0; g6 = ((g1 + 267) ^ g3) | 0; g7 = ((g2 + 274) ^ g4) | 0; g0 = ((g3 + 281) ^ g5) | 0; g1 = ((g4 + 288) ^ g6) | 0; g2 = ((g5 + 295) ^ g7) | 0; g3 = ((g6 + 302) ^ g0) | 0; g4 = ((g7 + 309) ^ g1) | 0; g5 = ((g0 + 316) ^ g2) | 0; g6 = ((g1 + 323) ^ g3) | 0; g7 = ((g2 + 330) ^ g4) | 0; } if ((a & 15) === 11) note(); return ((a ^ 1) + k + j - m) | 0; };
}
function fourth(k: number, j: number, m: number): (a: number) => number {
  return (a: number): number => { if (g7 > 1000000) { g0 = ((g3 + 1) ^ g5) | 0; g1 = ((g4 + 8) ^ g6) | 0; g2 = ((g5 + 15) ^ g7) | 0; g3 = ((g6 + 22) ^ g0) | 0; g4 = ((g7 + 29) ^ g1) | 0; g5 = ((g0 + 36) ^ g2) | 0; g6 = ((g1 + 43) ^ g3) | 0; g7 = ((g2 + 50) ^ g4) | 0; g0 = ((g3 + 57) ^ g5) | 0; g1 = ((g4 + 64) ^ g6) | 0; g2 = ((g5 + 71) ^ g7) | 0; g3 = ((g6 + 78) ^ g0) | 0; g4 = ((g7 + 85) ^ g1) | 0; g5 = ((g0 + 92) ^ g2) | 0; g6 = ((g1 + 99) ^ g3) | 0; g7 = ((g2 + 106) ^ g4) | 0; g0 = ((g3 + 113) ^ g5) | 0; g1 = ((g4 + 120) ^ g6) | 0; g2 = ((g5 + 127) ^ g7) | 0; g3 = ((g6 + 134) ^ g0) | 0; g4 = ((g7 + 141) ^ g1) | 0; g5 = ((g0 + 148) ^ g2) | 0; g6 = ((g1 + 155) ^ g3) | 0; g7 = ((g2 + 162) ^ g4) | 0; g0 = ((g3 + 169) ^ g5) | 0; g1 = ((g4 + 176) ^ g6) | 0; g2 = ((g5 + 183) ^ g7) | 0; g3 = ((g6 + 190) ^ g0) | 0; g4 = ((g7 + 197) ^ g1) | 0; g5 = ((g0 + 204) ^ g2) | 0; g6 = ((g1 + 211) ^ g3) | 0; g7 = ((g2 + 218) ^ g4) | 0; g0 = ((g3 + 225) ^ g5) | 0; g1 = ((g4 + 232) ^ g6) | 0; g2 = ((g5 + 239) ^ g7) | 0; g3 = ((g6 + 246) ^ g0) | 0; g4 = ((g7 + 253) ^ g1) | 0; g5 = ((g0 + 260) ^ g2) | 0; g6 = ((g1 + 267) ^ g3) | 0; g7 = ((g2 + 274) ^ g4) | 0; g0 = ((g3 + 281) ^ g5) | 0; g1 = ((g4 + 288) ^ g6) | 0; g2 = ((g5 + 295) ^ g7) | 0; g3 = ((g6 + 302) ^ g0) | 0; g4 = ((g7 + 309) ^ g1) | 0; g5 = ((g0 + 316) ^ g2) | 0; g6 = ((g1 + 323) ^ g3) | 0; g7 = ((g2 + 330) ^ g4) | 0; } if ((a & 15) === 13) throw new RangeError("thirteen " + k); return (a + k + 3 + j - m) | 0; };
}
const makers = [first, second, third, fourth];
const wide = (parseInt("0" + (process.argv[2] ?? ""), 10) | 0) + 0;
const holders: Holder[] = [];
for (let i = 0; i < 16; ++i) holders.push({ f: makers[i & 3](i + wide, wide * 3 + i, wide * 4 + i), next: null });
for (let i = 0; i < 16; ++i) holders[i].next = holders[(i + 1) & 15];
function walk(start: Holder, r: number): number {
  let h: Holder = start;
  r = h.f(r); h = h.next!;
  r = h.f(r); h = h.next!;
  r = h.f(r); h = h.next!;
  r = h.f(r); h = h.next!;
  r = h.f(r); h = h.next!;
  r = h.f(r); h = h.next!;
  r = h.f(r); h = h.next!;
  r = h.f(r); h = h.next!;
  r = h.f(r); h = h.next!;
  r = h.f(r); h = h.next!;
  r = h.f(r); h = h.next!;
  r = h.f(r); h = h.next!;
  r = h.f(r); h = h.next!;
  r = h.f(r); h = h.next!;
  r = h.f(r); h = h.next!;
  r = h.f(r); h = h.next!;
  return r;
}
let x = 1;
let caught = 0;
for (let i = 0; i < 400; ++i) {
  try {
    x = walk(holders[i & 15], x);
  } catch (error) {
    ++caught;
    traces.push(shorten(((error as Error).stack ?? "").split("\n").slice(0, 3)));
    x = (x + 5) | 0;
  }
}
console.log(x, caught, traces.length, g0 + g1 + g2 + g3 + g4 + g5 + g6 + g7);
console.log([...new Set(traces)].sort().join("\n"));
