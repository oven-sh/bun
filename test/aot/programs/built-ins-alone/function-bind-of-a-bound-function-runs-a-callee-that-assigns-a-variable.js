let state = 0;
function target() {
  state = "changed";
}
target.bind(undefined).bind(null)();
console.log(typeof state, state.length);
