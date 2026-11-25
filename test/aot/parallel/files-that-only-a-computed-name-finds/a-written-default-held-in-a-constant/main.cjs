const name = process.env.MADE_UP_CONF || "./conf.cjs";
const conf = require(name);
console.log(conf.name);
