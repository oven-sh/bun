let state = "open";
const stack = new DisposableStack();
stack.defer(() => {
  state = 0.5;
});
const moved = stack.move();
console.log(stack.disposed, state);
moved.dispose();
console.log(typeof state, state + 1);
