const stack = new DisposableStack();
stack.defer(() => {
  throw { code: 1.5 };
});
stack.defer(() => {
  throw "text";
});
try {
  stack.dispose();
} catch (error) {
  console.log(error instanceof SuppressedError, error.error.code + 1, error.suppressed.length);
}
