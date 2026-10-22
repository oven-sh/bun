let state = 0;
function target() {
  state = "changed";
}
Reflect.apply(target, undefined, { length: 0 });
console.log(typeof state, state.length);
