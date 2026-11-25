const conf = require(process.argv[2] ? process.argv[2] : "./conf.cjs");
console.log(conf.name);
