const name = Buffer.from(__dirname + "/settings.json").toString();
const required = require(name);
import(name).then(async loaded => {
  loaded.default.mode = "second";
  console.log(required === loaded.default, required.mode, loaded.default.mode);
  console.log(require(name) === required, (await import(name)).default === loaded.default);
});
exports.keeps = () => require("./settings.json");
