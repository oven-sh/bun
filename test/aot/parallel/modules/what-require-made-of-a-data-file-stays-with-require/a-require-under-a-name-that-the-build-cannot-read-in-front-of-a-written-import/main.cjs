// The other way round: the loader parses the file for require(), and the import that the build has linked has an object of its own.
const required = require(Buffer.from(__dirname + "/settings.json").toString());
import("./settings.json").then(loaded => {
  loaded.default.mode = "second";
  console.log(required === loaded.default, required.mode, loaded.default.mode);
});
