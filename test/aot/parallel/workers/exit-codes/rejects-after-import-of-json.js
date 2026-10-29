await import("./data.json");
Promise.reject(new Error("after import"));
postMessage("end of entry");
