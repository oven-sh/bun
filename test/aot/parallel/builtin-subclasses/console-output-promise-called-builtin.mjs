// How the console shows `Promise` in a program that only hands it to a built-in function as a callback.
try {
  [() => {}].forEach(Promise);
} catch (error) {
  console.log(error.constructor.name, error.message);
}
console.log(Promise, Bun.inspect(Promise));
