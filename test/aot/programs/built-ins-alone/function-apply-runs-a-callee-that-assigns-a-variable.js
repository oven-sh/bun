let state = 0;
function target() {
  state = "changed";
}
target.apply(undefined, []);
console.log(typeof state, state.length);
