// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const stack = new DisposableStack();
stack.use({
  [Symbol.dispose]() {
    console.log("used");
  },
});
stack.adopt(1, n => console.log("adopted", n));
stack.defer(() => console.log("deferred"));
const moved = stack.move();
moved.dispose();
console.log(moved.disposed);
