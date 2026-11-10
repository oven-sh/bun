const table = { first: Buffer };
const k = process.argv.length > 99 ? "none" : ["fir", "st"].join("");
console.log(table[k].from("6869", "hex").toString("latin1"), table[k].isBuffer(table[k].alloc(1)));
