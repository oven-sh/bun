// A CommonJS file holds JSX, and the runtime that its elements import is an ES module. Nothing else loads the runtime. One element is made while the file loads.
// `bun <file>` refuses such a file: the import of the runtime lands inside the CommonJS wrapper.
// Reference: bun build --compile
// Env of the executable: BUN_JSC_validateAOTRuntime=1
console.log("main starts");
import { View } from "./View.jsx";
for (const a of [1, 2]) console.log(View({ a }));
