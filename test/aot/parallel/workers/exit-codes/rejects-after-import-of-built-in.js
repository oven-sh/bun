await import("node:fs");
Promise.reject(new Error("after import"));
postMessage("end of entry");
