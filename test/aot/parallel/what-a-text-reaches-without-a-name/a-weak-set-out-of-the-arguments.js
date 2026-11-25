// The constructor of a WeakSet walks the object of the arguments.
const kept = {};
const other = {};
function held() {
  return new WeakSet(arguments);
}
console.log(held(kept).has(kept), held(kept).has(other));
