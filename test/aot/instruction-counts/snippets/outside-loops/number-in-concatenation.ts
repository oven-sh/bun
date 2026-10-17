// joins a string and a number that is not an integer, outside loops
const operations = 4;
let share: number = process.argv.length + 0.5;
let label: string = "share " + process.argv.length;
let total = 0;

kernel: {
  total += (label + share).length;
  total += (label + (share + 1)).length;
  total += (label + (share + 2)).length;
  total += (label + (share + 3)).length;
}

console.log(total);
