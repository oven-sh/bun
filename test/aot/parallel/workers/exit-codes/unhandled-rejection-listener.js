process.on("unhandledRejection", reason => postMessage("listener: " + reason.message));
Promise.reject(new Error("top level"));
postMessage("end of entry");
