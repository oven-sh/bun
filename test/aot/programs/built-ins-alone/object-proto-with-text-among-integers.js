const subject = { first: 1, second: 2 };
const result = subject.__proto__;
console.log(typeof result, Object.keys(result).join());
