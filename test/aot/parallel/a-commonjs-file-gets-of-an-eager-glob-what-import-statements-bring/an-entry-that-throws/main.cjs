// Reference: bun build --compile
let said;
try {
  said = Object.keys(require("./lib.cjs")).join();
} catch (error) {
  said = error.name + ": " + error.message;
}
console.log(said);
