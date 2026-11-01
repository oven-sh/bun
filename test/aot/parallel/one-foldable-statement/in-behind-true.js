const isDev = true;
const R = (isDev ? "a" : "b") in { a: 1 };
console.log(R);
