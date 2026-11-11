const interop = loaded => (loaded && loaded.__esModule ? loaded.default : loaded);
const ladle = require("./ladle.mjs");
console.log(ladle.__esModule, typeof ladle.default, interop(ladle) === ladle, typeof interop(ladle), ladle.holds, ladle.size);
