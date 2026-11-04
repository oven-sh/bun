const isDev = false;
const R = Math.max(...(isDev ? [1, 2] : [3]));
console.log(R);
