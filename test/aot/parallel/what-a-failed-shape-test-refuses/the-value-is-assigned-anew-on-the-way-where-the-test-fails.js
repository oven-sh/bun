function read(o, spare) { let host = o.host; if (host === undefined) { o = spare; host = o.host; } return host + "/" + o.retries; }
const bags = [{ host: "a", retries: 1 }, { port: 2 }, { other: 3 }];
let told = ""; for (let i = 0; i < 9; i++) told += read(bags[i % 3], bags[0]) + " ";
console.log(told);
