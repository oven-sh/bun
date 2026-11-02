process.on("exit", code => console.log("exit-listener.js: exit listener", code, process.exitCode));
Promise.reject(new Error("top level"));
postMessage("end of entry");
