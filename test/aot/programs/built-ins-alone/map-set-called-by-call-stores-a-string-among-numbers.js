const sizes = new Map([["small", 1]]);
Map.prototype.set.call(sizes, "large", "huge");
console.log(sizes.size, typeof sizes.get("large"), sizes.get("large").length);
