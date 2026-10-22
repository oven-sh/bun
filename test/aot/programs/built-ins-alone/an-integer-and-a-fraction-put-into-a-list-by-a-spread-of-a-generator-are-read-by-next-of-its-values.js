function* values() {
  yield 7;
  yield 1.5;
}
const held = [...values()];
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value + 1);
