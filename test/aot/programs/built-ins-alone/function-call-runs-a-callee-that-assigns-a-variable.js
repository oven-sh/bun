let state = 0;
function target() {
  state = "changed";
}
target.call(undefined);
console.log(typeof state, state.length);
