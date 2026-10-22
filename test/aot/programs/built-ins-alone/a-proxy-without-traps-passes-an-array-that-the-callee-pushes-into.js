const numbers = [1, 2];
function target(holder) {
  holder.push("three");
}
new Proxy(target, {})(numbers);
console.log(numbers.length, typeof numbers[2], numbers[2].length);
