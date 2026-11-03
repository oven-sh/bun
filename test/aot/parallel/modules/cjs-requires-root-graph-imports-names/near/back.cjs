console.log("near back begins");
try {
  console.log("near back has", Object.keys(require("./a.mjs")).join());
} catch (error) {
  console.log("near back catches", error.name);
}
console.log("near back ends");
