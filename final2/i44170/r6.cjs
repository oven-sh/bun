process.on("uncaughtException", e => console.log("handled", e.message));
process.on("unhandledRejection", () => { console.log("first"); throw new Error("x"); });
process.on("unhandledRejection", () => console.log("second"));
Promise.reject(new Error("r"));
