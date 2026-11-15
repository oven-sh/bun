import text from "./settings.json" with { type: "text" };
import settings from "./settings.json" with { type: "json" };
const required = require("./settings.json");
console.log(Object.keys(required).join(), typeof required.default, text.trim(), settings.name);
