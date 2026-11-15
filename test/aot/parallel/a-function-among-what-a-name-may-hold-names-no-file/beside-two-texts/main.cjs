const uses = {
  a: "./lib/part.js",
  quiet() {
    return 1;
  },
  b: "./sub/part.js",
};
const said = [];
for (const name in uses) if (typeof uses[name] === "string") said.push(require(uses[name]).value);
console.log("SAID", said.join());
