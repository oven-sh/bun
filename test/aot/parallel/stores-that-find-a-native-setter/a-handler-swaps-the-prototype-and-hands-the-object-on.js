const stop = new AbortController();
const signal = stop.signal;
let held;
signal.onabort = function () {
  held = this;
  Object.setPrototypeOf(this, { greet() { return "from the new prototype"; }, get aborted() { return "laid over"; } });
};
stop.abort();
console.log(held === signal, signal.greet(), signal.aborted, signal instanceof AbortSignal);
