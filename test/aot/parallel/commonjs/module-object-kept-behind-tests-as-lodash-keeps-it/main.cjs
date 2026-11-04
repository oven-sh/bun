// As every package of lodash begins: `module` is kept in a variable behind tests, and `exports` and `require` are read off the variable.
// `a && b` answers `a` only where `a` is no object, so the variable holds the module object or no object, and all that is done with it is in sight: nobody asks who required whom.
// If the mention counted as handed on, this one file would make every CommonJS file of the program keep its module object, begin with an exports object and record every require().
// COUNT: operation:operationAOTRecordRequire = 0
const a = require("./a.cjs");
const b = require("./b.cjs");
console.log(JSON.stringify(a.report()), b.name);
