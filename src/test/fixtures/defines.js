if (process.env.NODE_ENV === "production") {
  var foo;
  var bar = 1;
} else {
  console.log("hi");
}

const wasm_imports_sym =
  process.env.NODE_ENV === "development"
    ? "wasm_imports"
    : Symbol("wasm_imports");

console.log(foo);

require("react").createElement();

module.exports.bacon = true;
