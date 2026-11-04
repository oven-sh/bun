const isDev = false;
const R = (isDev ? [] : {}) instanceof Array;
console.log(R);
