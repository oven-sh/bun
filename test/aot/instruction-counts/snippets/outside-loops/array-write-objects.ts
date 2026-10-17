// writes strings into an array, outside loops
const operations = 4;
let names: string[] = ["a", "b", "c", "d", "e", "f", "g" + process.argv.length];
let name: string = "name" + process.argv.length;
let at: number = process.argv.length > 50 ? 3 : 1;
let total = 0;

kernel: {
  names[at] = name;
  names[at + 1] = name;
  names[at + 2] = name;
  names[at + 3] = name;
  total += 1;
}

console.log(total, names.join());
