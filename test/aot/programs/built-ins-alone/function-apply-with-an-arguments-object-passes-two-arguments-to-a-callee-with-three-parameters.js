let receiver;
function target(first, second, third, fourth = "default") {
  console.log(first + 1, second.length);
  console.log(third === undefined, typeof third, fourth.length);
  console.log(arguments.length);
}
function relay() {
  return target.apply(receiver, arguments);
}
((receiver = undefined), relay(1.5, "two"));
