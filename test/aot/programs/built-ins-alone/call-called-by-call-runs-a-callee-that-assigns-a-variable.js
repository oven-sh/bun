let state = 0;
function target() {
  state = "changed";
}
Function.prototype.call.call(target, undefined);
console.log(typeof state, state.length);
