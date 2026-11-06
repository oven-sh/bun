// Two CommonJS files hold JSX, and the runtime that their elements import is a CommonJS module, as React's is. Nothing else loads the runtime.
// Env of the executable: BUN_JSC_validateAOTRuntime=1
console.log("main starts");
const { View } = require("./View.jsx");
const other = require("./Other.jsx");
for (const a of [1, 2]) console.log(View({ a }), other(a));
