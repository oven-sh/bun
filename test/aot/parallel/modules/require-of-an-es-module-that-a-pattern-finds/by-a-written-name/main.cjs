const page = require("./pages/home.mjs");
console.log(typeof page, typeof page === "function" ? page() : Object.keys(page).join());
