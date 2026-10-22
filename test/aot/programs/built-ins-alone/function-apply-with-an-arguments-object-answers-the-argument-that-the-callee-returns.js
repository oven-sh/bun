let receiver;
function target(first, second) {
  return second;
}
function relay() {
  return target.apply(receiver, arguments);
}
const result = ((receiver = undefined), relay(1, "two"));
console.log(typeof result, result.length);
