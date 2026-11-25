const conf = await import(process.env.MADE_UP_CONF || "./conf.mjs");
console.log(conf.name);
