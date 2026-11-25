let sum = 0;
Array.prototype.forEach.call(JSON.parse("[1,2,3]"), function (value) {
  sum += value * this.factor;
}, { factor: 2 });
console.log(`${sum} ${Array.prototype.map.call("ab", letter => letter + letter).join()}`);
