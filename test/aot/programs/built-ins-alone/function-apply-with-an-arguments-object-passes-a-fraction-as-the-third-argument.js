let receiver;
function target(first, second, third, fourth, fifth) {
  console.log(typeof third, third + 1);
}
function relay() {
  return target.apply(receiver, arguments);
}
((receiver = undefined), relay(0, 1, 2.5, 3, 4));
