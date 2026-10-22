const list = [1.5, "two", { three: 3 }];
const record = { first: 1.5, second: "two" };
console.log(list[0] + 1, list[1].length, list[2].three + 1, record.first + 1, record.second.length, Object.keys(record).join());
