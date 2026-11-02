process.exitCode = 5;
Promise.reject(new Error("top level"));
