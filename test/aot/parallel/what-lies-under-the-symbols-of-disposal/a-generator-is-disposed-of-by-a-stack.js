function* numbers() {
  try {
    yield 1;
  } finally {
    console.log("closed");
  }
}
const stack = new DisposableStack();
const walk = stack.use(numbers());
walk.next();
stack.dispose();
console.log("behind");
