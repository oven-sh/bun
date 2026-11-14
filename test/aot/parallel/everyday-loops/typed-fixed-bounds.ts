// Written bounds over lists declared as numbers, as texts and as either
function weave(numbers: number[], texts: string[]): string {
  const both: (number | string)[] = [];
  const sums: number[] = [];
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 2; k++) {
      both.push(numbers[k], texts[i]);
      sums.push(numbers[i] + k);
    }
    both.push(i);
    sums.push(both.length);
  }
  return both.join() + " " + sums.join();
}
console.log(weave([1, 2, 3], ["a", "b", "c"]));
console.log(weave([0.5, -0, 1e300], ["", "x"]));
console.log(weave([], []));
