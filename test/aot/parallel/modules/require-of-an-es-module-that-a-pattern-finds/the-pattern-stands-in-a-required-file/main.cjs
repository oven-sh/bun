const { pick } = require("./lib/loader.cjs");
const page = pick(JSON.parse('"shop"'), JSON.parse('"home"'));
console.log(typeof page, typeof page === "function" ? page() : Object.keys(page).join());
