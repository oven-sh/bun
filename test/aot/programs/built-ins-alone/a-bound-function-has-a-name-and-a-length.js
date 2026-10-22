function work(first, second, third) {}
const bound = work.bind(null, 1);
console.log(bound.name, bound.length + 1, typeof bound.prototype);
