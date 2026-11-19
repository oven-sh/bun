let port = 3000;
try {
  port = require("./plugin.mjs").port;
} catch {}
console.log("listening on", port);
