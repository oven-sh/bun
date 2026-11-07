// process.stdin that is destroyed with an error reports the error and stays destroyed: resume() does not take it back.
const stdin = process.stdin;
stdin.on("error", err => console.log("error", err.message));
stdin.on("close", () => console.log("close", stdin.destroyed));
stdin.destroy(new Error("mine"));
stdin.resume();
setImmediate(() => setImmediate(() => console.log(stdin.destroyed, stdin.readableFlowing)));
