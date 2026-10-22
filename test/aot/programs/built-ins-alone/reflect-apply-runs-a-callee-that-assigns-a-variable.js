let state = 0;
function target() {
  state = "changed";
}
Reflect.apply(target, undefined, []);
console.log(typeof state, state.length);
