// resumes one async generator by awaiting next() and reads done and value
async function* naturals(): AsyncGenerator<number, void, void> {
  for (let n = 0; ; n++) yield n;
}
const operations = 20;
const numbers = naturals();
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const result = await numbers.next();
    if (result.done) break;
    total += result.value;
  }
}

console.log(total);
