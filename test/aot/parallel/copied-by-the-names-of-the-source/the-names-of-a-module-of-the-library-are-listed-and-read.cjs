// What nobody knows may be the exports of a module of the library.
function kinds(source) {
  let functions = 0;
  for (const key in source) if (typeof source[key] === "function") functions++;
  return functions > 10;
}
const held = [JSON.parse("{}"), require("node:path")];
for (const one of held) console.log(kinds(one));
function call(source) {
  for (const key in source) if (key === "basename") return source[key]("/made/up.txt");
}
console.log(call(held[1]));
