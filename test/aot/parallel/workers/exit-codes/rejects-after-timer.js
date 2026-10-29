await new Promise(resolve => setTimeout(resolve, 5));
Promise.reject(new Error("after timer"));
postMessage("end of entry");
