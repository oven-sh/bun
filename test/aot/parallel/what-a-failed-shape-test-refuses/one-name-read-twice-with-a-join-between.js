function twice(o, flag) { const first = o.host; let between = 0; if (flag) between = 1; const second = o.host; return first + "|" + second + "|" + between; }
const bags = [{ host: "a", retries: 1 }, { port: 2 }, { other: 3 }, { host: "b", retries: 2 }];
let told = ""; for (let i = 0; i < 12; i++) told += twice(bags[i % 4], i & 1) + " ";
console.log(told);
