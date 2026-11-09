const load = (name = "./conf.cjs") => require(name);
const conf = load(process.env.MADE_UP_CONF);
console.log(conf.name);
