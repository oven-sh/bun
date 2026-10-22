const groups = Object.groupBy([1.5, 2.5, "three"], value => typeof value);
console.log(groups.number.length, groups.number[1] + 1, groups.string[0].length, Object.keys(groups).join());
console.log(groups.boolean === undefined, Object.getPrototypeOf(groups) === null);
