// awaits a promise that is settled, outside loops
const operations = 2;
let settled: Promise<number> = Promise.resolve(process.argv.length);
let total = 0;

kernel: {
  total += await settled;
  total += await settled;
}

console.log(total);
