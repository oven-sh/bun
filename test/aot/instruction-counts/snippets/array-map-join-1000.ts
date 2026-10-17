// joins a thousand short strings made by map() and reads a character of the result
const operations = 1000;
const numbers: number[] = [];
for (let i = 0; i < operations; i++) numbers.push(i);
const digits = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
let total = 0;

kernel: {
  total += numbers.map(n => digits[n % 10]!).join(",").charCodeAt(7);
}

console.log(total);
