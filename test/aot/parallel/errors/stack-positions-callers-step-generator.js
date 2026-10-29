// Prints the frames of an error that the body of a generator throws, with the line of the call that ran the body.
function fail() { throw new Error("fail"); }
function* cleansUp() { try { yield 1; yield 2; } finally { fail(); } }
function* failsInSecondStep() { yield 1; fail(); yield 2; }
function* failsWhenThrownInto() { try { yield 1; } catch { fail(); } }
function show(label, f) {
  try {
    f();
    console.log(label, "did not throw");
  } catch (error) {
    const frames = error.stack.split("\n").slice(1, 4);
    console.log(label, frames.map(line => line.trim().replace(/\(?[^\s()]*[\\/][^:]*/, "")).join(" | "));
  }
}
show("next, return", () => {
  const steps = cleansUp();
  steps.next();
  steps.return();
});
show("next, next", () => {
  const steps = failsInSecondStep();
  steps.next();
  steps.next();
});
show("next, throw", () => {
  const steps = failsWhenThrownInto();
  steps.next();
  steps.throw(1);
});
show("next, next, return", () => {
  const steps = cleansUp();
  steps.next();
  steps.next();
  steps.return();
});
show("for of, break", () => {
  for (const x of cleansUp()) {
    if (x)
      break;
  }
});
show("for of, return", () => {
  for (const x of cleansUp()) {
    if (x)
      return;
  }
});
show("for of, second step", () => {
  for (const x of failsInSecondStep()) {
    x;
  }
});
show("destructuring", () => {
  const [
    first
  ] = cleansUp();
});
show("on one line", () => { const steps = cleansUp(); steps.next(); steps.return(); });
