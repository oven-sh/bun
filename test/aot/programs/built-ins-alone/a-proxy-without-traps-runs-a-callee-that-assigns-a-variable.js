let state = 0;
function target() {
  state = "changed";
}
new Proxy(target, {})();
console.log(typeof state, state.length);
