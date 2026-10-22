// `require.main === module` in the entry point and in a required module.
console.log(require.main === module, require("./a.cjs").main);
