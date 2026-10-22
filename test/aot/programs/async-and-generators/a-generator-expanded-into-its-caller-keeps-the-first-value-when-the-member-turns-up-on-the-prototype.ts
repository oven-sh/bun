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
  return `${step.result} [${Object.keys(step)}]`;
}
function drain(step: Step) {
  const steps = stepwise(step);
  const first = steps.next().value;
  steps.next();
  return `${first} ${steps.next().value}`;
}
console.log(drain(new Step(1)));
(Step.prototype as any)[["re", "sult"].join("")] = 60;
console.log(drain(new Step(2)));
