const isDev = true;
const R = [isDev ? 1 : 2, 3, 4].reduce((a, b) => a + b, 0);
console.log(R);
