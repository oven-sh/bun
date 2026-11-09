const { MADE_UP_CONF = "./conf.cjs" } = process.env;
const conf = require(MADE_UP_CONF);
console.log(conf.name);
