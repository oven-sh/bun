const handler = {
  apply(callee, self, passed) {
    return Reflect.apply(callee, self, passed);
  },
};
let state = 0;
function target() {
  state = "changed";
}
new Proxy(target, handler)();
console.log(typeof state, state.length);
