const list = JSON.parse("[1,2,3]");
console.log(`${Array.prototype.findLast.apply(list, [value => value < 3])} ${JSON.stringify(Object.fromEntries.apply(null, [[["made", "up"]]]))}`);
