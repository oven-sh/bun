const show = (name, value) =>
  console.log(name, Array.isArray(value) ? "a list of " + value.map(n => n * 2).join() : Object.keys(value).join());
const config = require("./config.json");
show("json:", config);
show("a list:", require("./list.json"));
show("toml:", require("./settings.toml"));
show("of a package:", require("settings-of-a-package/defaults.json"));
show("read by name:", require("./read-by-name.json"));
require("./inner.cjs");
config.port = 8080;
console.log("stored:", config.port, require("./config.json").port);
exports.again = () => {
  show("json, later:", require("./config.json"));
  show("a list, later:", require("./list.json"));
  console.log("the same object:", require("./config.json") === config, require("./config.json").port);
};
