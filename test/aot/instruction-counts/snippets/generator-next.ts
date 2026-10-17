// resumes one generator by calling next() and reads done and value
function* naturals(): Generator<number, void, void> {
  for (let n = 0; ; n++) yield n;
}
const operations = 100;
const numbers = naturals();
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const result = numbers.next();
    if (result.done) break;
    total += result.value;
  }
}

console.log(total);
