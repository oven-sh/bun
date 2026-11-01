console.log("first begins");
process.on("uncaughtException", error => console.log("nobody caught", error.name, error.message));
try {
  console.log("first got", Object.keys(require("./outer.mjs")).join());
} catch (error) {
  console.log("first caught", error.name, error.message);
}
console.log("first ends");
process.on("exit", code => console.log("exit", code));
