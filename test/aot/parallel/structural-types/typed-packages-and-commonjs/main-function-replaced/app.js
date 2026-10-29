const p = require("main");
p.x = () => "replaced";
console.log(p.x(), require("main").x());
