const pick = name => require(`./pages/${name}.mjs`);
for (const name of JSON.parse('["home", "about", "plain", "home"]')) {
  const page = pick(name);
  console.log(name, typeof page, typeof page === "function" ? page() : typeof page === "object" ? Object.keys(page).join() : page);
}
