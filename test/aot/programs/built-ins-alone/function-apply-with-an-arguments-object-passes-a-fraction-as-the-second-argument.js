let receiver;
function target(first, second, third, fourth, fifth) {
  console.log(typeof second, second + 1);
}
function relay() {
  return target.apply(receiver, arguments);
}
((receiver = undefined), relay(0, 1.5, 2, 3, 4));
