let state = "open";
const stack = new DisposableStack();
stack.defer(() => {
  state = 0.5;
});
stack.dispose();
console.log(typeof state, state + 1);
