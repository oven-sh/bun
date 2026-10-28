import "./awaits.mjs";
console.log("requires goes on");
try {
  console.log(Object.keys(require("./required.mjs")).join());
} catch (error) {
  console.log("require() throws a", error.name);
}
