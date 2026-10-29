// Two closures share a variable that holds a list. A loop calls the one that reads an element, and one turn calls the one that stores a shorter list or cuts the list.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
function shelf(first: number[]) {
  let list = first;
  return {
    read: (j: number): number => {
      const e = list[j & 7];
      return e === undefined ? -1000 : e + list.length;
    },
    replace: (next: number[]): void => {
      list = next;
    },
    cut: (): void => {
      list.length = 2;
    },
  };
}
function work(i: number, at: number, n: number): number {
  const { read, replace, cut } = shelf([i, 1, 2, 3, 4, 5, 6, 7]);
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (j === at) i & 1 ? replace([0.5, i]) : cut();
    sum = mix(sum, read(j));
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i, i % 30, 24));
console.log(total);
