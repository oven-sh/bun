await import("./fine.js");
Promise.reject(new Error("after import"));
postMessage("end of entry");
