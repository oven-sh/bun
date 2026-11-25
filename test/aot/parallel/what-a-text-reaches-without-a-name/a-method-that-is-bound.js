const bound = [].map.bind([1, 2, 3]);
const applied = Function.prototype.call.bind([].filter);
console.log(bound(value => value * 3).join(), applied([1, 2, 3], value => value !== 2).join());
