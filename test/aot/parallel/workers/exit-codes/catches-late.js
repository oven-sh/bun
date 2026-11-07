const promise = Promise.reject(new Error("caught late"));
setTimeout(() => promise.catch(error => postMessage("caught " + error.message)), 5);
postMessage("end of entry");
