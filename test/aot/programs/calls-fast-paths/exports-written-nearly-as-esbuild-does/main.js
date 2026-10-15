// The helper is not esbuild's own text, so the module keeps its object: it is filled by the helper's loop, and a name is read by a property access.
// IR+ ForInKeys
// IR+ (GetById|CallMethod) v[0-9]+ "add"
// IR+ GetById v[0-9]+ "limit"
const nearly = require("./files/nearly.js");
console.log(nearly.add(2, 3), nearly.limit, nearly.renamed(), Object.getOwnPropertyDescriptor(nearly, "add").configurable);
