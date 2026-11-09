let name = process.env.MADE_UP_CONF;
name ||= "./conf.mjs";
const conf = await import(name);
console.log(conf.name);
