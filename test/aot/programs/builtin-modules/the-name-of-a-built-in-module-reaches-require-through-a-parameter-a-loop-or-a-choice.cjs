// As its neighbor in TypeScript, with the `require` of a CommonJS file.
const throughAnArrow = name => require(name);
console.log("an arrow", typeof throughAnArrow("fs").readFileSync);

function throughAFunction(name) {
  return require(name);
}
console.log("a function", typeof throughAFunction("node:path").join);

const inALoop = name => require(name);
for (const name of ["fs", "node:path", "node:os"]) console.log("a loop", name, typeof inALoop(name));

for (const name of ["node:util", "node:url"]) console.log("without a function", name, typeof require(name));

const isFirst = process.argv.length < 100;
console.log("a choice", typeof require(isFirst ? "node:vm" : "node:v8").runInNewContext);
