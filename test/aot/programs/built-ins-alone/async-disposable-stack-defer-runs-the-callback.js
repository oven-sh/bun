let state = "open";
const stack = new AsyncDisposableStack();
stack.defer(async () => {
  state = 0.5;
});
await stack.disposeAsync();
console.log(typeof state, state + 1);
