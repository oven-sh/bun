const numbers = [1, 2];
Reflect.apply(Array.prototype.push, numbers, ["three"]);
console.log(numbers.length, typeof numbers[2], numbers[2].length);
