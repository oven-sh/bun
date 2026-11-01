// `new Transform()`: the constructors ask `this instanceof Transform` and `this instanceof Duplex`. $toClass has put each function below its base's,
// and nothing ever makes a Duplex here. Where those tests failed, the rest of both constructors stored its fields by name.
// COUNT: arrivals <= 25000
const { Transform } = require("node:stream");
let length = 0;
for (let i = 0; i < 3000; i++) length += new Transform().writableLength;
console.log(length);
