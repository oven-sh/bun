const isDev = true;
const R = `${isDev ? "a" : "b"}-${isDev ? "c" : "d"}`;
console.log(R);
