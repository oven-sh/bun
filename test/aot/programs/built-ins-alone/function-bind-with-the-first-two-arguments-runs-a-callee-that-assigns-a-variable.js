let state = 0;
function target() {
  state = "changed";
}
target.bind(undefined)();
console.log(typeof state, state.length);
