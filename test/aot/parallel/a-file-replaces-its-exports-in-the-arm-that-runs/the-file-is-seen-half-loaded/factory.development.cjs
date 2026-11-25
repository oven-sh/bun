const back = require("./index.cjs");
const seen = typeof back + " " + Object.keys(back).length;
back.laidEarly = 1;
module.exports = function make() { return seen + " " + (require("./index.cjs") === make) + " " + back.laidEarly; };
