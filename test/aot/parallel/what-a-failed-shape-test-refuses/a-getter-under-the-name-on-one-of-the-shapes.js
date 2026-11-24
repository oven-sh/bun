let calls = 0;
function read(o) { return String(o.host) + "/" + String(o.port); }
const bags = [{ host: "a", retries: 1 }, { port: 2 }, { get host() { calls++; return "got"; }, other: 3 }];
let told = ""; for (let i = 0; i < 9; i++) told += read(bags[i % 3]) + " ";
console.log(told, calls);
