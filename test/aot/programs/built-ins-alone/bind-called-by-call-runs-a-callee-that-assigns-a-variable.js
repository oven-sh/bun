let state = 0;
function target() {
  state = "changed";
}
Function.prototype.bind.call(target, undefined)();
console.log(typeof state, state.length);
