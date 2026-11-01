const isDev = true;
const R = { [isDev ? "a" : "b"]: "http://localhost" };
console.log(R);
