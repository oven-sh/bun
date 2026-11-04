const pick = name => require(`./pages/${name}.mjs`);
const names = JSON.parse('["home", "plain"]');
let functions = 0, objects = 0;
for (let i = 0; i < 300; i++) {
  const page = pick(names[i % 2]);
  if (typeof page === "function") functions++;
  else if (typeof page === "object") objects++;
}
console.log(functions, objects);
