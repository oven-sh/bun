// Entry points: ./pages/home.mjs
const page = require(JSON.parse('"./pages/home.mjs"'));
console.log(typeof page, typeof page === "function" ? page() : Object.keys(page).join());
