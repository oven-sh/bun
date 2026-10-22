const list = await Promise.all([1.5, Promise.resolve("two"), { three: 3 }]);
console.log(list.length, list[0] + 1, list[1].length, list[2].three + 1);
