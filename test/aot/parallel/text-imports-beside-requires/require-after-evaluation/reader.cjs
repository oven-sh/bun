const settings = require("./settings.json");
console.log("required", settings.name, settings.n, settings.deep && settings.deep.k, typeof settings.default);
