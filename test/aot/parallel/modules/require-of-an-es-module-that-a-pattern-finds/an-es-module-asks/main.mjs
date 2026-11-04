const pick = name => import.meta.require(`./pages/${name}.mjs`);
const page = pick(JSON.parse('"home"'));
console.log(typeof page, typeof page === "function" ? page() : Object.keys(page).join());
