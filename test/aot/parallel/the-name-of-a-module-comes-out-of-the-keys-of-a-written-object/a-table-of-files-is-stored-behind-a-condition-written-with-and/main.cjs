let table;
process.argv.length < 99 && (table = { a: "./one.cjs" });
console.log("SAID", require(table.a).name);
