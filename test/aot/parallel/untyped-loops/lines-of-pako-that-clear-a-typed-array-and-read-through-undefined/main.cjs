// Alone: whether the loop runs on vectors goes by what else the executable holds
// Lines of pako 3.0.3 (MIT, github.com/nodeca/pako, dist/pako.cjs.js), cut down for the build, which stopped in gen_bitlen. They no longer run to their end.
const pako = require("./lines-of-pako.cjs");
try {
  console.log(Buffer.from(pako.inflate(pako.deflate("hello hello"))).toString());
} catch (error) {
  console.log(error.constructor.name, error.message);
}
