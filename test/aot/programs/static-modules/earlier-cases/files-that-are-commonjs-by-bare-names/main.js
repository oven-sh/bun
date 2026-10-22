// Files that mention `exports`, `module` or `require` only in tests, UMD headers and factories.
const base64 = require("./base64"), filled = require("./filled"), umd = require("./umd"), factory = require("./factory");
require("./shadowed"); require("./typeofs");
console.log(base64.sizeOf("abcd"), base64.looksRight("ab+/"), base64.looksRight("~"), filled.filled, globalThis.fromShadowed, globalThis.kinds);
console.log(typeof umd, umd(), umd._ === umd, umd.moduleExports, typeof globalThis._, factory.made, typeof globalThis.Factory);
console.log(require("./viaes.mjs").all);
