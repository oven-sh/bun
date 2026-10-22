// A new `module.exports` leaves earlier holders with the old object.
console.log(Object.keys(require("./a.cjs")).join(), require("./b.cjs").read());
