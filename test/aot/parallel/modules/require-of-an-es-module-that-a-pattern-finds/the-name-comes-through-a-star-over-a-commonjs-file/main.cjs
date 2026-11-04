// `export * from` a CommonJS file: which names the ES module has shows at run time.
const pick = name => require(`./pages/${name}.mjs`);
for (const name of JSON.parse('["starred", "bare"]')) {
  const page = pick(name);
  console.log(name, typeof page, typeof page === "object" ? Object.keys(page).sort().join() : page);
}
