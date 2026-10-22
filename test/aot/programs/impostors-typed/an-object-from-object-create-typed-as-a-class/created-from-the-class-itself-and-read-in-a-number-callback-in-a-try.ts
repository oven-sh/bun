class Safe {}
function attempt(run: () => number): number { try { return run(); } catch (error) { return error ? 1 : 2; } }
const bare: Safe = Object.create(Safe);
console.log("got", attempt(() => (bare as any).code));
