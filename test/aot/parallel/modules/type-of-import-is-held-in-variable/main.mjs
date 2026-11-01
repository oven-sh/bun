// The type of an import is held in a variable.
const options = { with: { type: "text" } };
const loaded = await import("./other.mjs", options);
console.log(JSON.stringify(loaded.default));
/* Output:
5
*/
