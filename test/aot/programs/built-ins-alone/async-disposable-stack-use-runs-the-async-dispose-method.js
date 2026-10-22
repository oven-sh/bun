let state = "open";
const resource = {
  async [Symbol.asyncDispose]() {
    console.log("dispose", this === resource);
    state = 0.5;
  },
};
const stack = new AsyncDisposableStack();
stack.use(resource);
await stack.disposeAsync();
console.log(typeof state, state + 1);
