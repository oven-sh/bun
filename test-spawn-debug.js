const cp = require("child_process");
const fs = require("fs");

// Create a test script that just prints its process info
const testScript = `
console.log('Child process info:');
console.log('argv:', process.argv);
console.log('execArgv:', process.execArgv);
console.log('env.BUN_DEBUG_TRACE:', process.env.BUN_DEBUG_TRACE);
`;

fs.writeFileSync("test-child.js", testScript);

console.log("Parent forking child with execArgv...");
const child = cp.fork("./test-child.js", ["arg1", "arg2"], {
  execArgv: ["--trace-event-categories", "node.environment"],
  env: { ...process.env, BUN_DEBUG_TRACE: "1" },
});

child.on("exit", code => {
  console.log("Child exited with code:", code);
  fs.unlinkSync("test-child.js");
});
