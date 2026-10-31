console.log("far back begins");
try {
  console.log("far back has", Object.keys(require("./a.mjs")).join());
} catch (error) {
  console.log("far back catches", error.name);
}
console.log("far back ends");
