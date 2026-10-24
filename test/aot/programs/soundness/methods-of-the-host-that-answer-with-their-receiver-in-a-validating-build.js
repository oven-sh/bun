// ref, unref, refresh and close of a timer answer with the timer itself. The table says that native code keeps the receiver and that the result is anything, which covers it.
const timeout = setTimeout(() => console.log("never"), 100000);
console.log(timeout.unref() === timeout, timeout.ref() === timeout, timeout.refresh() === timeout, timeout.hasRef(), timeout.close() === timeout);
const interval = setInterval(() => console.log("never"), 100000).unref();
console.log(typeof interval.hasRef(), interval.hasRef(), interval.ref().unref().hasRef());
clearInterval(interval);
const immediate = setImmediate(() => console.log("ran"));
console.log(immediate.unref() === immediate, immediate.ref() === immediate, immediate.hasRef());
const kept = [setTimeout(() => {}, 1).unref(), setInterval(() => {}, 100000).unref()];
kept[0].tag = "first";
console.log(kept.map(timer => typeof timer[Symbol.toPrimitive]()).join(), kept[0].tag, kept[0].unref().tag);
clearInterval(kept[1]);
