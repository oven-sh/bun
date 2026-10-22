const sizes = new Map([["small", 1.5]]);
console.log(sizes.getOrInsertComputed("large", key => key.length + 0.5) + 1, sizes.get("large") + 1);
