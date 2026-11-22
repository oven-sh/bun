// A listener for uncaught exceptions that is laid behind the store cannot keep the process: the store always runs, and it throws first.
Array.prototype.push = () => 0;
process.on("uncaughtException", () => { console.log("SAID caught"); });
/* Build errors:
error: TS100014: this assignment always throws: built-in objects are read-only in a compiled executable
*/
