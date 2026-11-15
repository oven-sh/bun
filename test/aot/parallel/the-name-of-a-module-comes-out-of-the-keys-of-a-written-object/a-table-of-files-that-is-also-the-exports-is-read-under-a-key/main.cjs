const table = (module.exports = { a: "./one.cjs", b: "./two.cjs" });
console.log("SAID", require(table[process.argv.length > 99 ? "b" : "a"]).name);
