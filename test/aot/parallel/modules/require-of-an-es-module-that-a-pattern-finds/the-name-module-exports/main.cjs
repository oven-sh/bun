// An ES module that exports the name "module.exports" answers `require` with what the name holds, also where a pattern finds the file.
const pick = name => require(`./pages/${name}.mjs`);
const page = pick(JSON.parse('"home"'));
console.log(typeof page, typeof page === "function" ? page() : Object.keys(page).join());
