const map = Reflect.get([1, 2, 3], "map");
console.log(String(Reflect.apply(map, [1, 2, 3], [(x) => x * 2])));
