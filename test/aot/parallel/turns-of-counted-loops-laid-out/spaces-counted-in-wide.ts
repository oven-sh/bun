function run(s: string): number { let n = 0; for (let i = 0; i < s.length; i++) { if (s.charCodeAt(i) === 32) n++; } return n; }

const lengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 23, 24, 25, 31, 32, 33, 63, 64, 65, 100, 1000];
function once(length: number): void {
  let input = ''; for (let i = 0; i < length; i++) input += i % 5 ? '\u03a9' : ' ';
  console.log(length, run(input));
}
for (let k = 0; k < lengths.length; k++) once(lengths[k]);
