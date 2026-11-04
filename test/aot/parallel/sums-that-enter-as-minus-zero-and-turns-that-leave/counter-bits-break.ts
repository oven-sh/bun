function say(value: number): string { return Object.is(value, -0) ? "-0" : String(value); }
function run(start: number, n: number, stop: number, mask: number): number { let sum = start * 1; const end = n | 0, halt = stop | 0; for (let i = 0; i < end; i++) { if (i === halt) break; sum += i & mask; } return sum; }
function once(length: number, at: number, filler: number, start: number): string { return say(run(start, length, at, filler * 3)); }
const lengths = [0, 1, 7, 8, 9, 15, 16, 17, 24, 40];
const starts = [-0, 0, 5, -5, 0.5, -0.5, NaN, Infinity, -Infinity, 4503599627370496, -4503599627370497];
for (let k = 0; k < lengths.length; k++) { for (let filler = 0; filler < 2; filler++) { for (let at = -1; at <= lengths[k] && at < 19; at++) { let said = ""; for (let s = 0; s < starts.length; s++) said += once(lengths[k], at, filler, starts[s]) + " "; console.log(lengths[k], filler, at, said); } } }
