const numbers = [1, 2];
const add = numbers.push.bind(numbers);
add("three");
console.log(numbers.length, typeof numbers[2], numbers[2].length);
