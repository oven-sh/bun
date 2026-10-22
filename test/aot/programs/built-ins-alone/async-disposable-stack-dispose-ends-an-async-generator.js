let state = "open";
async function* values() {
  try {
    yield 1;
  } finally {
    state = 0.5;
  }
}
const running = values();
await running.next();
const stack = new AsyncDisposableStack();
stack.use(running);
await stack.disposeAsync();
console.log(typeof state, state + 1);
