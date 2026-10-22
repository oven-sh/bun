const numbers = [1, 2];
function target(holder) {
  holder.push("three");
}
Reflect.apply(target, undefined, { length: 1, 0: numbers });
console.log(numbers.length, typeof numbers[2], numbers[2].length);
