// makes a string of an integer, outside loops
const operations = 4;
let id: number = process.argv.length | 0;
let total = 0;

kernel: {
  total += ("" + (id | 0)).length;
  total += ("" + ((id + 100) | 0)).length;
  total += ("" + ((id + 1000) | 0)).length;
  total += ("" + ((id + 10000) | 0)).length;
}

console.log(total);
