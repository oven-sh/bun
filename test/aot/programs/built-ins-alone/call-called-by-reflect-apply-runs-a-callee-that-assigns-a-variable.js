let state = 0;
function target() {
  state = "changed";
}
Reflect.apply(Function.prototype.call, target, [undefined]);
console.log(typeof state, state.length);
