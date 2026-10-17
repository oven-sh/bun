// reads the code of a character, outside loops
const operations = 4;
let text: string = "a text of some length " + process.argv.length;
let at: number = process.argv.length > 50 ? 9 : 2;
let total = 0;

kernel: {
  total += text.charCodeAt(at);
  total += text.charCodeAt(at + 1);
  total += text.charCodeAt(at + 2);
  total += text.charCodeAt(at + 3);
}

console.log(total);
