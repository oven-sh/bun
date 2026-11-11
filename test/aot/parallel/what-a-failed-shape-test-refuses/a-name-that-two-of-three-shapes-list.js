function read(o) { return o.host + "/" + o.port; }
const bags = [{ host: "a", retries: 1 }, { port: 2, host: "b" }, { other: 3 }];
let told = ""; for (let i = 0; i < 9; i++) told += read(bags[i % 3]) + " ";
console.log(told);
