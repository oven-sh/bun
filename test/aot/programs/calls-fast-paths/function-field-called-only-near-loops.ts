// A field that holds one function is called only in functions that run near a loop. Each site calls the function directly: it neither reads the field nor tests the closure.
// IR= 0 first CallMethod v[0-9]+ \(.*\) name="step"(?!.* isFallback)
// IR= 0 second CallMethod v[0-9]+ \(.*\) name="step"(?!.* isFallback)
// IR- ^ .*IsClosureOf
class Counter {
  total = 0;
  step = (by: number): number => {
    this.total += by;
    return this.total;
  };
}

function first(counter: Counter): number {
  return counter.step(1);
}

function second(counter: Counter): number {
  return counter.step(2);
}

const steps = [first, second];

function both(counter: Counter): number {
  return first(counter) + second(counter);
}

function run(counter: Counter, rounds: number): number {
  let result = 0;
  for (let i = 0; i < rounds; i++) result += both(counter);
  return result;
}

console.log(run(new Counter(), 5), steps.length, steps[1](new Counter()));
