let name = process.env.MADE_UP_CONF;
name ??= "./conf.cjs";
const conf = require(name);
console.log(conf.name);
