const numbers = [1, 2];
function afterwards() {
  console.log(numbers.length, typeof numbers[2], numbers[2].length);
}
function target(holder) {
  holder.push("three");
  afterwards();
}
setImmediate(target, numbers);
