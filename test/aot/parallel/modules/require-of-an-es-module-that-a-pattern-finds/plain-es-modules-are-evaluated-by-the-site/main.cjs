// None of the candidates has a name that only the run time can answer for: the site evaluates them itself.
const pick = name => require(`./pages/${name}.mjs`);
for (const name of JSON.parse('["one", "two"]')) console.log(name, pick(name).text, Object.keys(pick(name)).join());
