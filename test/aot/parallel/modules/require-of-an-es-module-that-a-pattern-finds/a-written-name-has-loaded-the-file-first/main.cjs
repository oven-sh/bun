const written = require("./pages/home.mjs");
const pick = name => require(`./pages/${name}.mjs`);
const page = pick(JSON.parse('"home"'));
console.log(typeof written, typeof page, written === page);
