class Safe {}
function attempt(run: () => number): number { return run(); }
function make(): Safe { return Object.create(Safe.prototype); }
const bare = make();
console.log("got", attempt(() => (bare as any).code));
