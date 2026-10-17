// throws into a suspended generator, which catches the value and yields again
function* resilient(): Generator<number, void, void> {
  let caught = 0;
  for (;;) {
    try {
      yield caught;
    } catch (error) {
      caught += error as number;
    }
  }
}
const operations = 100;
const numbers = resilient();
numbers.next();
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const result = numbers.throw(1);
    if (result.done) break;
    total = result.value;
  }
}

console.log(total);
