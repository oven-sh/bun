// A field that holds one function is called in a loop: the site tests one byte and calls the function directly. It does not test the closure.
// IR+ IsClassObjectUnmodified
// IR= 0 sum IsClosureOf
class Counter {
  total = 0;
  step = (by: number): number => {
    this.total += by;
    return this.total;
  };
}

function sum(counter: Counter, rounds: number): number {
  let result = 0;
  for (let i = 0; i < rounds; i++) result += counter.step(1);
  return result;
}

console.log(sum(new Counter(), 5));
