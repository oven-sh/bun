// fills a template with two strings, outside loops
const operations = 4;
let left: string = "left" + process.argv.length;
let right: string = "right" + process.argv.length;
let total = 0;

kernel: {
  total += `${left}:${right}`.length;
  total += `${right}:${left}`.length;
  total += `${left}:${left}`.length;
  total += `${right}:${right}`.length;
}

console.log(total);
