const stop = new AbortController();
const signal = stop.signal;
signal.kept = 1;
signal.plain = 2;
signal.onabort = function () {
  delete this.kept;
  Object.defineProperty(this, "plain", { get() { return "from the getter"; }, configurable: true });
};
stop.abort();
console.log("kept" in signal, signal.kept, signal.plain);
