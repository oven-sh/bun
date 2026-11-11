const settings = require("./settings.json");
console.log("cjs", Object.keys(settings).join(), settings.level, typeof settings.default);
