function* values() {
  yield 1.5;
  yield 2.5;
}
const held = [...values()];
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value + 1);
