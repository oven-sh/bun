function read(o) { return String(o.host) + "/" + String(o.port); }
const late = { port: 2 };
const bags = [{ host: "a", retries: 1 }, late, { other: 3 }];
let told = ""; for (let i = 0; i < 6; i++) told += read(bags[i % 3]) + " ";
late.host = "late";
for (let i = 0; i < 6; i++) told += read(bags[i % 3]) + " ";
console.log(told);
