class Safe {}
function attempt(run: () => number): number { return run(); }
const bare = Object.create(Safe.prototype) as Safe;
console.log("got", attempt(() => (bare as any).code));
