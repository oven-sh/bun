// takes two elements out of an array whose type is not known
const lists: any[] = [
  [1, 2, 3, 4, 5],
  ["a", "b", "c", "d"],
  [0.5, 1.5, 2.5, 3.5],
];
const operations = 60;
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) sum += lists[i % 3].slice(1, 3).length;
}

console.log(sum);
