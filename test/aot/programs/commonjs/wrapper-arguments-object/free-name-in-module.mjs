console.log(typeof arguments);
try {
  arguments;
} catch (error) {
  console.log(error instanceof ReferenceError);
}
console.log((() => typeof arguments)());
