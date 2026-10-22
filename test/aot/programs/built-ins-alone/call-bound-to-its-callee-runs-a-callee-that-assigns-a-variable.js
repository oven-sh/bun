let state = 0;
function target() {
  state = "changed";
}
Function.prototype.call.bind(target)(undefined);
console.log(typeof state, state.length);
