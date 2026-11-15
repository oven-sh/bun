// The same store is handed what cannot be called and then a function: it goes by all that arrives.
const stop = new AbortController();
const signal = stop.signal;
signal.seen = 0;
function listen(handler) { signal.onabort = handler; }
listen(null);
console.log(signal.onabort, signal.seen);
listen(function () { this.seen = "the handler ran"; });
stop.abort();
console.log(typeof signal.onabort, signal.seen);
