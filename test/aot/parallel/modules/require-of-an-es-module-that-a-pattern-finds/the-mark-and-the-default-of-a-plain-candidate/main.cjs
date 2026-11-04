const pick = name => require(`./pages/${name}.mjs`);
const page = pick(JSON.parse('"plain"'));
console.log(typeof page, page.__esModule, page.default, page.a, Object.keys(page).join());
