// COUNT: operation:operationAOTRequireModule = 0
const pick = name => require(`./pages/${name}.cjs`);
for (const name of JSON.parse('["one", "two"]')) console.log(name, pick(name).text, Object.keys(pick(name)).join());
