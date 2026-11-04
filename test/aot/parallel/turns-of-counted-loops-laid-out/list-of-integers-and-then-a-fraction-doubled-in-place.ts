function run(list: number[]): string { for (let i = 0; i < list.length; i++) list[i] = list[i] * 2; return list.join(); }

const lengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 23, 24, 25, 31, 32, 33, 63, 64, 65, 100, 1000];
function once(length: number): void {
  const input: number[] = []; for (let i = 0; i < length; i++) input.push(i === length - 1 ? 0.5 : i);
  console.log(length, run(input).slice(-70));
}
for (let k = 0; k < lengths.length; k++) once(lengths[k]);
