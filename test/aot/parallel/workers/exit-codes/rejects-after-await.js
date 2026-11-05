await 0;
Promise.reject(new Error("after await"));
postMessage("end of entry");
