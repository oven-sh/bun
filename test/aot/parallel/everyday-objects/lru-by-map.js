// A cache of limited size over the order of a Map
class Cache {
  constructor(size) {
    this.size = size;
    this.map = new Map();
    this.misses = 0;
  }
  get(key, make) {
    if (this.map.has(key)) {
      const value = this.map.get(key);
      this.map.delete(key);
      this.map.set(key, value);
      return value;
    }
    this.misses++;
    const value = make(key);
    this.map.set(key, value);
    if (this.map.size > this.size) this.map.delete(this.map.keys().next().value);
    return value;
  }
}
function run(keys, size) {
  const cache = new Cache(size);
  const sum = keys.reduce((total, key) => total + cache.get(key, n => n * n), 0);
  return sum + " " + cache.misses + " " + [...cache.map.keys()].join();
}
console.log(run([1, 2, 1, 3, 2], 2));
console.log(run([5, 5, 5], 1));
console.log(run([1, 2, 3, 1, 2, 3], 3));
