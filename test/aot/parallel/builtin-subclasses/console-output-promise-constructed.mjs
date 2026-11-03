// How the console shows `Promise` in a program where only built-in functions construct or call it.
console.log(Promise);
const made = Reflect.construct(Promise, [() => {}]);
console.log(Promise, made.constructor, Bun.inspect(Promise));
try {
  [() => {}].map(Promise);
} catch (error) {
  console.log(error.constructor.name, error.message);
}
console.log([Promise], { Promise });
