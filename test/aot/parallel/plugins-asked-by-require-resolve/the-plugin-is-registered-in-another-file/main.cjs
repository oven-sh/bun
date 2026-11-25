require("./setup.cjs");
const last = (text) => String(text).split("/").pop();
const pick = process.argv.length > 5 ? "./b.cjs" : "./a.cjs";
console.log(last(require.resolve(pick)), last(require.resolve("./a.cjs")));
