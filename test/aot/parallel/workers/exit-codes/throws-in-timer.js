setTimeout(() => {
  throw new Error("timer");
}, 5);
postMessage("end of entry");
