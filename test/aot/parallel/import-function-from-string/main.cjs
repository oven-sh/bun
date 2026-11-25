// CommonJS code from TypeScript hides an import() in a string. The files that it names are in the executable.
var load = new Function("path", "return import(path)");
const loadAgain = Function("path", "return import(path);");
function choose(name) {
  return name === "late" ? load("./lib/late.mjs") : load("./lib/early.mjs");
}
(async () => {
  console.log((await choose("early")).name, (await choose("late")).name);
  console.log((await loadAgain("./lib/data.json")).default.list.length);
  console.log((await new Function("return import('./lib/third.mjs')")()).default(20));
  console.log((await eval("import('./lib/third.mjs')")).default(1), typeof (await eval('import("node:path")')).join);
  console.log(load.name, load.length, String(load));
  console.log(load.hasOwnProperty("prototype"), new Function("return import('./lib/third.mjs')").length);
  await load("./lib/missing.mjs").catch(error => console.log(error.code));
})();
/* Output:
early late
3
21
2 function
anonymous 1 function anonymous(path
) {
return import(path)
}
true 0
ERR_MODULE_NOT_FOUND
*/
