const isDev = false;
const R = { [isDev ? "a" : "b"]: "http://localhost" };
console.log(R);
