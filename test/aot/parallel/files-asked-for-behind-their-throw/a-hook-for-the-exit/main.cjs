// a hook for the exit asks for the file whose uncaught throw ends the process
// Exit code: 1
globalThis.runs = 0;
globalThis.atExit = [];
process.on("exit", () => { for (const hook of globalThis.atExit) hook(); });
require("./store.cjs");
