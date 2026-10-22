const sizes = new Map([["small", 1.5]]);
const missing = sizes.get("large");
console.log(missing === undefined, typeof missing, sizes.get("small") + 1, missing ?? 0.5);
