const numbers = [1, 2];
Array.prototype.push.call(numbers, "three");
console.log(numbers.length, typeof numbers[2], numbers[2].length);
