Object.defineProperty(exports, "inner", { enumerable: true, get() { return require("./required-by-getter.cjs"); } });
console.log("lazy-require ends");
