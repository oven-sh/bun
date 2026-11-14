function attempt(name, ask) {
  try {
    console.log(name, ask());
  } catch (error) {
    console.log(name, error.message);
  }
}
class Counter {
  *each(count, first) {
    for (let i = 0; i < count; i++) yield first + i;
  }
  nothing() {}
}
const counter = new Counter();
let last;
function sum(count) {
  const steps = counter.each(count, 1);
  let total = 0;
  for (;;) {
    last = steps.next();
    if (last.done) return total;
    total += last.value;
  }
}
function runs() {
  const steps = counter.nothing();
  for (;;) last = steps.next();
}
for (let round = 0; round < 2; round++) {
  attempt("three", () => sum(3));
  attempt("none", () => sum(0));
  attempt("nothing", () => runs());
  let left = 4;
  counter.each = () => ({
    next: () => {
      if (--left < 0) throw new Error("over");
      return { value: left, done: left === 0 };
    },
  });
  attempt("own", () => sum(3));
  attempt("over", () => sum(3));
  counter.nothing = () => ({
    next: () => {
      throw new Error("left");
    },
  });
  attempt("left", () => runs());
  delete counter.each;
  delete counter.nothing;
}
