const isDev = true;
const R = (isDev ? [] : {}) instanceof Array;
console.log(R);
