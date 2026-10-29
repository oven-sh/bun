const p = require("aliases");
p.x = () => "replaced";
console.log(p.x(), require("aliases").x());
