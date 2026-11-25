const stop = new AbortController();
const signal = stop.signal;
signal.count = 1;
signal.onabort = function (event) { this.count = "by this"; event.target.other = "by the target"; event.currentTarget.third = 3; };
stop.abort();
console.log(signal.count, signal.other, signal.third);
