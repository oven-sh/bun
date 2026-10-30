// A switch with one case, whose code stands right behind the switch's compares. Built as the cold code of a very large program is (see the .json beside this file).
// Found by ../../fuzz/operators-at-the-edges.ts and cut down by hand: code that is made without optimizing moves values between registers on the way to the default case, behind
// the compares, and the case that came next took those moves for made: it multiplied the quotient that the division had left behind. The output is that of plain Bun.
const ends = [
  0, 1, -1, 2, -2, 3, 7, 8, 1073741824, 1073741825, 2147483646, 2147483647, -2147483648, 1431655765, -1431655766,
];
function tried(x: number, y: number, q: number): number {
  const a = x | 0;
  const b = y | 0;
  const u = x >>> 0;
  const v = y >>> 0;
  switch ((-b | 0 ? Math.max((b / a) | 0, a) : 128) & 7) {
    case 6:
      return Math.imul(((a >>> 4) & 1) !== 1 ? v : u, -2) >>> 0;
  }
  return q % u;
}
for (let i = 0; i < ends.length; i++) {
  let line = ends[i] + ":";
  for (let j = 0; j < ends.length; j++) line += " " + tried(ends[i], ends[j], ends[j] | 0);
  console.log(line);
}
