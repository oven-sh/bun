const above = { host: "inherited" };
function read(o) { return String(o.host) + "/" + String(o.port); }
const below = Object.create(above); below.port = 7;
const bags = [{ host: "a", retries: 1 }, { port: 2 }, below, { other: 3 }];
let told = ""; for (let i = 0; i < 8; i++) told += read(bags[i % 4]) + " ";
console.log(told);
