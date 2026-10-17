// makes a promise, outside loops
const operations = 2;
let kept: Promise<number> = Promise.resolve(0);
let total = 0;

kernel: {
  kept = new Promise<number>(resolve => resolve(total));
  total += 1;
  kept = new Promise<number>(resolve => resolve(total));
  total += 1;
}

console.log(total, typeof kept);
