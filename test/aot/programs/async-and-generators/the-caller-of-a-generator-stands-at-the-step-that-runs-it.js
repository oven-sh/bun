// In a stack trace the caller of a generator's body stands at the step that runs the body, not where the generator was made.
function framesOf(error) {
  return error.stack
    .split("\n")
    .filter(line => line.includes("the-caller-of-a-generator") && !line.includes("module code"))
    .map(line => line.trim().replace(/\(.*[\\/]/, "(").replace(/at .*[\\/]/, "at ").replace(/the-caller-of-a-generator-stands-at-the-step-that-runs-it\.js/, ""))
    .join(" | ");
}
function show(label, action) {
  try {
    action();
    console.log(label, "did not throw");
  } catch (error) {
    console.log(label, error.message, framesOf(error));
  }
}
function* throwsAtSecondStep() {
  yield 1;
  throw new Error("second");
}
function* throwsAtFirstStep() {
  throw new Error("first");
}
function* delegates() {
  yield* throwsAtSecondStep();
}
show("next by hand, twice:", () => {
  const steps = throwsAtSecondStep();
  steps.next();
  steps.next();
});
show("next by hand, once:", () => {
  const steps = throwsAtFirstStep();

  steps.next();
});
show("for-of over a generator made earlier:", () => {
  const steps = throwsAtSecondStep();
  let sum = 0;
  for (const value of steps)
    sum += value;
  return sum;
});
show("for-of over a call:", () => {
  let sum = 0;
  for (const value of throwsAtSecondStep()) sum += value;
  return sum;
});
show("spread of a call:", () => [...throwsAtSecondStep()]);
show("Array.from:", () => {
  const steps = throwsAtSecondStep();
  return Array.from(steps);
});
show("a delegating generator:", () => {
  const steps = delegates();
  steps.next();
  steps.next();
});
show("next in a loop:", () => {
  const steps = throwsAtSecondStep();
  for (let i = 0; i < 3; i++)
    steps.next();
});
