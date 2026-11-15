const described = Object.getOwnPropertyDescriptor(Array.prototype, "map");
console.log(Reflect.get([], "map").call([1], value => value + 1).join(), Reflect.apply([].filter, [1, 2], [value => value > 1]).join(), described.value.call([1, 2], value => value * 2).join());
