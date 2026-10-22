let state = 0;
function target() {
  state = "changed";
}
target.apply(undefined, { length: 0 });
console.log(typeof state, state.length);
