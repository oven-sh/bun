// awaits a promise that is already fulfilled
const operations = 20;
const settled = Promise.resolve(1);
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) total += await settled;
}

console.log(total);
