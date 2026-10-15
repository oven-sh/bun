// A CommonJS module in the form esbuild gives to what was an ES module keeps its exports in variables: no object is filled, and a name is read without a property access.
// IR- GetById v[0-9]+ "(add|limit|renamed)"
// IR- CallMethod v[0-9]+ "(add|renamed)"
// IR- ForInKeys
const plain = require("./files/plain.js");
console.log(plain.add(2, 3), plain.limit, plain.renamed());
