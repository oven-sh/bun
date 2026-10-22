let state = "open";
function* values() {
  try {
    yield 1;
  } finally {
    state = 0.5;
  }
}
const running = values();
running.next();
const stack = new DisposableStack();
stack.use(running);
stack.dispose();
console.log(typeof state, state + 1);
