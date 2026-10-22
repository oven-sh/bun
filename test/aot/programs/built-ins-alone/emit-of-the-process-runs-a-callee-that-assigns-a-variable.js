let state = 0;
function target() {
  state = "changed";
}
process.on("ready", target);
process.emit("ready");
console.log(typeof state, state.length);
