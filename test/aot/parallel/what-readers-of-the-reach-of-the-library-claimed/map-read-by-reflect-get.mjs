const map = Reflect.get(Array.prototype, "map");
const doubled = Reflect.apply(map, [1, 2, 3], [(x) => x * 2]);
console.log(String(doubled));
