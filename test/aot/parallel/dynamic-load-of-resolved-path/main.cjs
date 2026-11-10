// Tools pass the path of a module in their options, and load it later. The module is in the executable.
const { go } = require("./go.cjs");
const options = { transform: { path: require.resolve("./go.cjs"), export: "go" } };
const load = ({ path, export: name }) => require(path)[name];
console.log(go(1), load(Object.assign({}, options.transform))(2), load(JSON.parse(JSON.stringify(options)).transform) === go);
import("./go.mjs").then(async ({ go, found }) => {
  console.log(go(3), (await import(JSON.parse(JSON.stringify({ found })).found)).go === go);
  console.log(Object.keys(require(load({ path: require.resolve("./go.cjs"), export: "where" })())).join());
});
/* Output:
2 3 true
4 true
go,where
*/
