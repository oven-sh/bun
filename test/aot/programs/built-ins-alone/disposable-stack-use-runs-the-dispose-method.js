let state = "open";
const resource = {
  [Symbol.dispose]() {
    console.log("dispose", this === resource);
    state = 0.5;
  },
};
const stack = new DisposableStack();
console.log(stack.use(resource) === resource);
stack.dispose();
console.log(typeof state, state + 1, stack.disposed);
