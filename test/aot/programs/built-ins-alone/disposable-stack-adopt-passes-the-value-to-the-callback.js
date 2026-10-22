const stack = new DisposableStack();
const kept = stack.adopt({ size: 1.5 }, value => {
  console.log(typeof value, value.size + 1);
});
console.log(kept.size + 1);
stack.dispose();
