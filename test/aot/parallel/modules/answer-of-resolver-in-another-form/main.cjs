// What a resolver has answered goes to a loader through a call that leaves it as it is, or that writes the same file as a path or as a URL.
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");

const chosen = process.argv[2] ?? "two";
const where = require.resolve("./parts/" + chosen + ".cjs");
console.log("trim():", require(where.trim()).label);
console.log("String():", require(String(where)).label);
console.log("a template:", require(`${where}`).label);
console.log("toString():", require(where.toString()).label);
console.log("a sum:", require(where + "").label);
console.log("normalize():", require(path.normalize(where)).label);
console.log("resolve():", require(path.resolve(where)).label);
console.log("a constant:", require(require.resolve("./parts/one.cjs").trim()).label);

(async () => {
  const module = require.resolve("./parts/" + chosen + ".mjs");
  console.log("pathToFileURL():", (await import(pathToFileURL(module))).label);
  console.log("the href of pathToFileURL():", (await import(pathToFileURL(module).href)).label);
  console.log("there and back:", (await import(fileURLToPath(pathToFileURL(module)))).label);
})();
