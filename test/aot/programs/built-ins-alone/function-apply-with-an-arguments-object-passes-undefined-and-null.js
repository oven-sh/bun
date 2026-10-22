let receiver;
function target(first, second, third, fourth, fifth) {
  console.log(first === undefined, typeof first);
  console.log(second === null, typeof second);
  console.log(third + 1, arguments.length);
}
function relay() {
  return target.apply(receiver, arguments);
}
((receiver = undefined), relay(undefined, null, 0.5));
