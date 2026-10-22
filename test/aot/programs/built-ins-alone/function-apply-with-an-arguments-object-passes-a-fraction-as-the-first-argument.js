let receiver;
function target(first, second, third, fourth, fifth) {
  console.log(typeof first, first + 1);
}
function relay() {
  return target.apply(receiver, arguments);
}
((receiver = undefined), relay(0.5, 1, 2, 3, 4));
