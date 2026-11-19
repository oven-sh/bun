function all(o) { return [o.host, o.port, o.retries, o.host, o.other].join(); }
const bags = [{ host: "a", retries: 1 }, { port: 2 }, { other: 3 }, {}];
let told = ""; for (let i = 0; i < 8; i++) told += all(bags[i % 4]) + " ";
console.log(told);
