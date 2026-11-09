let name = process.env.MADE_UP_CONF;
if (!name) name = "./conf.cjs";
const conf = require(name);
console.log(conf.name);
