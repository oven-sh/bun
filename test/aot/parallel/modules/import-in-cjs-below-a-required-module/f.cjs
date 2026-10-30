import("./c.mjs").then(() => console.log("c done"), e => console.log("rejected", e.name));
Promise.resolve().then(() => console.log("job of f"));
exports.v = "a" + process.argv.length;
console.log("f ends");
