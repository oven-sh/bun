class Safe {}
const bare: Safe = Object.create(Safe.prototype);
const run = (): number => (bare as any).code;
console.log("got", run());
