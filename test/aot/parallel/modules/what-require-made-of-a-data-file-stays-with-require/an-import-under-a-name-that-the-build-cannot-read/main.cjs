// require() has parsed the file. An import under a name of which the build knows nothing goes to the loader, which keeps its own modules: it parses the file again.
const required = require("./settings.json");
import(Buffer.from(__dirname + "/settings.json").toString()).then(loaded => {
  loaded.default.mode = "second";
  console.log(required === loaded.default, required.mode, loaded.default.mode);
  console.log(require("./settings.json") === required);
});
