let receiver;
let state = 0;
function target() {
  state = "changed";
}
function relay() {
  return target.apply(receiver, arguments);
}
((receiver = undefined), relay());
console.log(typeof state, state.length);
