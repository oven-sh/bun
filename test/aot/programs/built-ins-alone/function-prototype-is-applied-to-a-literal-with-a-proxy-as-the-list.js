const reads = [];
const list = new Proxy({ length: 2, 0: 0, 1: 0 }, {
  get(target, key) {
    reads.push(key);
    return target[key];
  },
});
Function.prototype.apply({}, list);
console.log(reads.join());
