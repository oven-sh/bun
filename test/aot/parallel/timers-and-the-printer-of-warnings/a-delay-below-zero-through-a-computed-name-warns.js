process.on("warning", warning => console.log("heard", warning.name));
setTimeout(() => console.log("rang first"), 1);
globalThis[["set", "Timeout"].join("")](() => console.log("rang second"), -1);
