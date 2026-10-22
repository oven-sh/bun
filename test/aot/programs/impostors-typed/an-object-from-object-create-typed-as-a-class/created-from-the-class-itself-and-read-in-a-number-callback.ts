class Safe {}
function attempt(run: () => number): number { return run(); }
const bare: Safe = Object.create(Safe);
console.log("got", attempt(() => (bare as any).code));
