let state = 0;
function target() {
  state = "changed";
}
await Promise.try(target);
console.log(typeof state, state.length);
