// The result of a bit operation is kept and, right behind it, tested for zero. A code generator that goes by the processor's flags must know which of these operations
// are made by an instruction that sets them: a mask of 255 or 65535, all ones, nothing, a complement and an operand combined with itself are made by moves.
function low(x: number): string { const y = x & 0xff; return (y ? "t" : "f") + y; }
function wide(x: number): string { const y = x & 0xffff; return (y ? "t" : "f") + y; }
function complement(x: number): string { const y = ~x; return (y ? "t" : "f") + y; }
function unchanged(x: number): string { const y = x | 0; return (y ? "t" : "f") + y; }
function allOnes(x: number): string { const y = x | -1; return (y ? "t" : "f") + y; }
function nothing(x: number): string { const y = x & 0; return (y ? "t" : "f") + y; }
function everything(x: number): string { const y = x & -1; return (y ? "t" : "f") + y; }
function flippedByNothing(x: number): string { const y = x ^ 0; return (y ? "t" : "f") + y; }
function withItself(x: number): string { const y = x & x; return (y ? "t" : "f") + y; }
function orItself(x: number): string { const y = x | x; return (y ? "t" : "f") + y; }
function againstItself(x: number): string { const y = x ^ x; return (y ? "t" : "f") + y; }
function ordinaryMask(x: number): string { const y = x & 0xf0; return (y ? "t" : "f") + y; }
function shiftedByNothing(x: number): string { const y = x << 0; return (y ? "t" : "f") + y; }
function shifted(x: number): string { const y = x << 24; return (y ? "t" : "f") + (y < 0 ? "n" : "p") + y; }
function found(list: number[], x: number): string { return ~list.indexOf(x) ? "in" : "out"; }
const inputs = [0, 1, -1, 255, 256, 65535, 65536, 0x7fffffff, -0x80000000, 0x100ff, 0xff00, 0x80, 0xf, 0x10];
for (const f of [low, wide, complement, unchanged, allOnes, nothing, everything, flippedByNothing, withItself, orItself, againstItself, ordinaryMask, shiftedByNothing, shifted])
  console.log(f.name, inputs.map(x => f((x + 1 - 1) | 0)).join(" "));
console.log(inputs.map(x => found([0, 255, 65536], x)).join(" "));
