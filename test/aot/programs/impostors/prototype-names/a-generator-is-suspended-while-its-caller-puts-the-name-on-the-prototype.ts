// A generator reads an optional field, yields it, reads it again behind the yield, stores it and lists the keys.
// While it is suspended its caller puts a value of that name on the prototype, under a computed key.
class Step {
  declare id: number;
  declare result?: number;
  constructor(id: number) {
    this.id = id;
  }
}
function* stepwise(step: Step): Generator<number | undefined, string, void> {
  yield step.result;
  yield step.result;
  step.result = 6;
  return `${step.result} [${Object.keys(step)}]`;
}
function drain(step: Step, between: () => void) {
  const steps = stepwise(step);
  const first = steps.next().value;
  between();
  const second = steps.next().value;
  return `${first} ${second} ${steps.next().value}`;
}

let length = 0;
for (let i = 0; i < 3000; i++) length += drain(new Step(i), () => {}).length;
console.log("warm", length);

const name = ["re", "sult"].join("");
console.log(
  "across a yield:",
  drain(new Step(1), () => {
    (Step.prototype as any)[name] = 60;
  }),
);
console.log("afterwards:", drain(new Step(2), () => {}));
delete (Step.prototype as any)[name];
console.log("gone again:", drain(new Step(3), () => {}));
