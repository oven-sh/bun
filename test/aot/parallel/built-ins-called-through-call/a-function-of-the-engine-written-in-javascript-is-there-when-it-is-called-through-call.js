const list = JSON.parse("[1,2,3]");
console.log(`${Array.prototype.findLastIndex.call(list, value => value < 3)} ${Array.prototype.flatMap.call(list, value => [value, value]).join()}`);
