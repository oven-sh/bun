// takes a part of a string, outside loops
const operations = 4;
let text: string = "a text of some length " + process.argv.length;
let from: number = process.argv.length > 50 ? 9 : 2;
let total = 0;

kernel: {
  total += text.substring(from, 9).length;
  total += text.substring(from, 10).length;
  total += text.substring(from, 11).length;
  total += text.substring(from, 12).length;
}

console.log(total);
