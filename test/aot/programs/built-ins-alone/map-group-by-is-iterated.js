const groups = Map.groupBy([1.5, 2.5, "three"], value => typeof value);
for (const [key, values] of groups) console.log(key.length, values.length, typeof values[0]);
