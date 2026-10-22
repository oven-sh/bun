const numbers = [1, 2];
function target(holder) {
  holder.push("three");
}
Function.prototype.bind.call(target, undefined, numbers)();
console.log(numbers.length, typeof numbers[2], numbers[2].length);
