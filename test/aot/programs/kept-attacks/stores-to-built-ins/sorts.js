// sorts.js <which> <size> <rounds>: an array of <size> numbers or strings in a fixed scrambled order is copied and sorted.
const which = process.argv[2], size = Number(process.argv[3] ?? 16), rounds = Number(process.argv[4] ?? 100);
const numbers = [], strings = [], objects = [];
let seed = 12345;
for (let i = 0; i < size; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; numbers.push((seed % 1000) | 0); strings.push("k" + (seed % 1000)); objects.push({ key: (seed % 1000) | 0, name: "n" + i }); }
let sum = 0;
for (let i = 0; i < rounds; i++) {
  switch (which) {
  case "copy": sum += numbers.slice().length; break;
  case "numbers": sum += numbers.slice().sort((a, b) => a - b)[0]; break;
  case "strings": sum += strings.slice().sort().length; break;
  case "stringsBy": sum += strings.slice().sort((a, b) => a < b ? -1 : a > b ? 1 : 0).length; break;
  case "locale": sum += strings.slice().sort((a, b) => a.localeCompare(b)).length; break;
  case "objects": sum += objects.slice().sort((a, b) => a.key - b.key)[0].key; break;
  case "toSorted": sum += numbers.toSorted((a, b) => a - b)[0]; break;
  }
}
console.log(which, size, rounds, sum);
