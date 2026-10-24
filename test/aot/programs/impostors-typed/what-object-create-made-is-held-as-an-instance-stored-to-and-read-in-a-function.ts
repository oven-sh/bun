// As its neighbor; the property is stored first, so nothing about the program is out of the ordinary at run time.
class Safe {}
const bare: Safe = Object.create(Safe.prototype);
(bare as any).code = 5;
function attempt(run: () => number): number { return run(); }
console.log("got", attempt(() => (bare as any).code));
