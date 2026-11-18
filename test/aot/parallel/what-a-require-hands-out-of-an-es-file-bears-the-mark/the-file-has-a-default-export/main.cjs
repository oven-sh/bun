const interop = loaded => (loaded && loaded.__esModule ? loaded.default : loaded);
const kettle = require("./kettle.mjs");
console.log(kettle.__esModule, typeof kettle.default, interop(kettle) === kettle.default, interop(kettle).holds, kettle.size);
