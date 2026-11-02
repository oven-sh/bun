// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const stack = new AsyncDisposableStack();
stack.use({
  async [Symbol.asyncDispose]() {
    console.log("used");
  },
});
stack.adopt(1, async n => console.log("adopted", n));
stack.defer(async () => console.log("deferred"));
const moved = stack.move();
await moved.disposeAsync();
console.log(moved.disposed);
