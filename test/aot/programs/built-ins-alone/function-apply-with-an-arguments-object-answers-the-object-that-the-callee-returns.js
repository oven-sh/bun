let receiver;
function target() {
  return { made: 1.5 };
}
function relay() {
  return target.apply(receiver, arguments);
}
const result = ((receiver = undefined), relay());
console.log(typeof result, result.made + 1);
