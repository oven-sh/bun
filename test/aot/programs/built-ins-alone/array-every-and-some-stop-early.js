let calls = 0;
console.log([1, 2, 3].every(value => (calls++, value < 2)), calls);
calls = 0;
console.log([1, 2, 3].some(value => (calls++, value > 1)), calls);
