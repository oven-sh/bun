class Safe {}
function attempt(run: () => number): number { return run(); }
let sum = 0; function note(value: number) { sum = Math.imul(sum, 31) + value | 0; }
const bare: Safe = Object.create(Safe);
note(attempt(() => (bare as any).code)); console.log("sum", sum);
