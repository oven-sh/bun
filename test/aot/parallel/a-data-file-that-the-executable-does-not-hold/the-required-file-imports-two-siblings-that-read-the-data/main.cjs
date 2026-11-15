let port = 3000;
try {
  port = require("./plugin.mjs").port;
} catch (error) {
  console.log(String(error.message).split("\n")[0]);
}
console.log("listening on", port);
