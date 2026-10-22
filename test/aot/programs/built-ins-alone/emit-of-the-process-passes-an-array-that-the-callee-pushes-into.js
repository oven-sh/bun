const numbers = [1, 2];
function target(holder) {
  holder.push("three");
}
process.on("ready", target);
process.emit("ready", numbers);
console.log(numbers.length, typeof numbers[2], numbers[2].length);
