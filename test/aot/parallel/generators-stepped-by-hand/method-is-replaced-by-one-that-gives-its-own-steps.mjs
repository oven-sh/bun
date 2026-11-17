// Under: --aot-harden=proof-checks: a guess at the callee stood in front of a step that reads `next` by itself, and the build stopped
function attempt(ask) {
  try {
    ask();
  } catch (error) {
    console.log(error.message);
  }
}
class Counter {
  each() {}
}
const counter = new Counter();
let last;
function runs() {
  const steps = counter.each();
  for (;;) last = steps.next();
}
let left = 3;
attempt(() => {
  counter.each = () => ({
    next: () => {
      if (--left < 0) throw new Error("over");
      return left;
    },
  });
});
attempt(() => runs());
console.log(last);
