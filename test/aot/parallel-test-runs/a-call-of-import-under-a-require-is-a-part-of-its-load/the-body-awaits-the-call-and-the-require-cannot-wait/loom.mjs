let bobbin;
try {
  ({ bobbin } = require("./bobbin.mjs"));
} catch (error) {
  console.log("the require throws", error.name);
  throw error;
}
export const loom = "loom with a " + bobbin;
