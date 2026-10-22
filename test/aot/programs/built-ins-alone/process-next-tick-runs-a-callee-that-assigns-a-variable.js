let state = 0;
function afterwards() {
  console.log(typeof state, state.length);
}
function target() {
  state = "changed";
  afterwards();
}
process.nextTick(target);
