const numbers = [1, 2];
Array.prototype.push.apply(numbers, ["three", "four"]);
console.log(numbers.length, typeof numbers[3], numbers[3].length);
