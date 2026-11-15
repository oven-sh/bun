const plug = require(process.env.MADE_UP_PLUG || "./plug.mjs");
console.log(plug.kind, "|", plug.shape);
