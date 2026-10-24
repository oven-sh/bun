// `_interopRequireDefault(require("./a.js"))` in a cycle, where a defines `__esModule` behind the require: at that moment the marker is absent and the helper wraps the object. The same call later finds the marker.
const a = require("./a.js");
console.log(a.fromB, require("./b.js").later());
