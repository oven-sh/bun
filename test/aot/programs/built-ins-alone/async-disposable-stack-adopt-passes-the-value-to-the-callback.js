const stack = new AsyncDisposableStack();
stack.adopt({ size: 1.5 }, async value => {
  console.log(typeof value, value.size + 1);
});
await stack.disposeAsync();
