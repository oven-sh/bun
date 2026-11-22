// One of two functions is handed out, and what it is handed is asked whether it has something.
module.exports = process.argv.length > 90 ? () => false : box => box.has("a");
if (require.main === module) console.log(module.exports(new Set(["a"])), module.exports({ has: name => name + "1" }));
