const groups = Map.groupBy([1.5, 2.5, "three"], value => typeof value);
console.log(groups.size, groups.get("number").length, groups.get("number")[1] + 1, groups.get("string")[0].length);
console.log(groups.get("boolean") === undefined, groups.has("number"));
