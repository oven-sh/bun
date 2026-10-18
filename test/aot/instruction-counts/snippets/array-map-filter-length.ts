// doubles numbers with map, keeps some with filter and asks how many are left
const operations = 100;
const numbers: number[] = [];
for (let i = 0; i < operations; i++) numbers.push(i * 5);
let total = 0;

kernel: {
  total += numbers.map(n => n * 2).filter(n => n % 3 === 0).length;
}

console.log(total);
