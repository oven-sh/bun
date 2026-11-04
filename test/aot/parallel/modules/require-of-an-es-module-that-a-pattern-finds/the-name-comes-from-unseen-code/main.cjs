const same = (0, eval)("(x) => x");
const page = require(`./pages/${same("home")}.mjs`);
console.log(typeof page, typeof page === "function" ? page() : Object.keys(page).join());
