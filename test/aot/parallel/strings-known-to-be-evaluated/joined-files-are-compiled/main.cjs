// Embedded files that are joined into the text of a function run compiled code, the constructors that the text makes too.
// Flags: --asset ./kit
// COUNTER: InterpretedFunctionCode = 0
const { Leaf, Pair, print } = require("./kit/tools/index.js");
console.log(print(new Pair({ left: new Leaf({ value: "x" }), right: new Leaf({ value: "y" }) })));
