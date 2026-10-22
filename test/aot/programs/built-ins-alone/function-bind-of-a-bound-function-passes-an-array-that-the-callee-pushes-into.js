const numbers = [1, 2];
function target(holder) {
  holder.push("three");
}
target.bind(undefined, numbers).bind(null)();
console.log(numbers.length, typeof numbers[2], numbers[2].length);
