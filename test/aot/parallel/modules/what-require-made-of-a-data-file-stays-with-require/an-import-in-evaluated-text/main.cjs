// The text is not compiled: its import is the loader's.
const required = require("./settings.json");
const text = Buffer.from(`import(${JSON.stringify(__dirname + "/settings.json")})`).toString();
(0, eval)(text).then(
  loaded => {
    loaded.default.mode = "second";
    console.log(required === loaded.default, required.mode, loaded.default.mode);
  },
  error => console.log("threw", error?.code ?? error?.name, required.mode),
);
