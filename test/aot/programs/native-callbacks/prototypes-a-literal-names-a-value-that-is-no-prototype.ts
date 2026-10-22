// `{ __proto__: value }` takes an object or null. Any other value is left out, and the literal stays under Object.prototype.
function under(value: any): any {
  return { __proto__: value, own: 1 };
}

const base = { inherited: 2 };
const values: any[] = [null, undefined, 1, "text", true, Symbol.iterator, 10n, base, function named() {}, [], Object.prototype];
for (const value of values) {
  const made = under(value);
  console.log(typeof value, typeof made.toString, typeof made.hasOwnProperty, made.inherited, typeof made.call, typeof made.push, "own" in made, Object.getPrototypeOf(made) === value);
}
