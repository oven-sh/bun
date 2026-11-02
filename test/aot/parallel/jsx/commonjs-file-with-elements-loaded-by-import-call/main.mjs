// A CommonJS file that holds JSX is loaded by import(). The runtime that its elements import hands on what another CommonJS file exports, as React's does.
// `bun <file>` refuses such a file: the import of the runtime lands inside the CommonJS wrapper.
// Reference: bun build --compile
// Env of the executable: BUN_JSC_validateAOTRuntime=1
console.log("main starts");
const { View } = await import("./View.jsx");
for (const a of [1, 2]) console.log(View({ a }));
