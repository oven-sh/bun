// The other half of module-object-kept-behind-tests-as-lodash-keeps-it: the variable is asked for `children` and `parent`, handed on, and read under a key that is computed.
// COUNT: operation:operationAOTRecordRequire >= 1
const a = require("./a.cjs");
const b = require("./b.cjs");
console.log(JSON.stringify(a.report()), b.name);
