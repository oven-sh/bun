const sizes = new Map([["small", 1.5]]);
console.log(sizes.getOrInsert("small", "new") + 1, sizes.getOrInsert("large", "new").length, sizes.get("large").length);
