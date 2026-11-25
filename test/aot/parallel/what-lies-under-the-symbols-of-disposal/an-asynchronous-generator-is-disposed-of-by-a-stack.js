async function* numbers() {
  try {
    yield 1;
  } finally {
    console.log("closed");
  }
}
const stack = new AsyncDisposableStack();
const walk = stack.use(numbers());
await walk.next();
await stack.disposeAsync();
console.log("behind");
