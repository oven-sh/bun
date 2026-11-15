const show = value => String(JSON.stringify(value)).slice(0, 40);
const first = require("./rows.json", { type: "text" });
const second = require("./rows.json");
console.log(first === second, show(first), show(second));
