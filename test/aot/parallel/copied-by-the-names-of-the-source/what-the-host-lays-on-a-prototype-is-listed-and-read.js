// The members that the host lays on the prototype of a request can be listed: the loop gives their names, and the read runs their getters.
function kinds(source) {
  const found = [];
  for (const key in source) found.push(`${key}:${typeof source[key]}`);
  return found.sort().join(" ");
}
const held = [JSON.parse("{}"), new Request("http://made.up/a", { method: "POST", body: "made up" })];
for (const one of held) console.log(kinds(one));
