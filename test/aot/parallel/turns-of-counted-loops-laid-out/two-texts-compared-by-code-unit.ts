function run(a: string, b: string): number { let n = 0; for (let i = 0; i < a.length; i++) { if (a.charCodeAt(i) === b.charCodeAt(i)) n++; } return n; }

const lengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 23, 24, 25, 31, 32, 33, 63, 64, 65, 100, 1000];
function once(length: number): void {
  let input = ''; let other = ''; for (let i = 0; i < length; i++) { input += i % 7 ? 'a' : 'b'; other += i % 3 ? 'a' : '\u03a9'; }
  console.log(length, run(input, other), run(other, input), run(input, input));
}
for (let k = 0; k < lengths.length; k++) once(lengths[k]);
