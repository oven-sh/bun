let receiver;
const numbers = [1, 2];
function target(holder) {
  holder.push("three");
}
function relay() {
  return target.apply(receiver, arguments);
}
((receiver = undefined), relay(numbers));
console.log(numbers.length, typeof numbers[2], numbers[2].length);
