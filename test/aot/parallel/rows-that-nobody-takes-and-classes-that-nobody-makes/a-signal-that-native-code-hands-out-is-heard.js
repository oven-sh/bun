const signal = AbortSignal.timeout(5);
signal.addEventListener("abort", () => console.log("aborted", signal.reason.name, signal.aborted));
console.log(signal.constructor.name, signal.aborted, Object.prototype.toString.call(signal));
