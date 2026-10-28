// A field that holds one function is called in a loop: the site calls the function directly. It neither reads the field nor tests the closure.
// IR= 0 sum PropGet v[0-9]+ name="step"(?!.* isFallback)
// IR= 0 sum CallMethod v[0-9]+ \(.*\) name="step"(?!.* isFallback)
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

// Called from two places: a function with one call site is copied into it and keeps no body for the expectations to look at.
console.log(sum(new Counter(), 5), sum(new Counter(), 2));
