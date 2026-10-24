const later = new Promise(resolve => setTimeout(resolve, 20, "loaded while the page was sent"));
console.log(await later);
const sooner = new Promise(resolve => setTimeout(resolve, 1));
console.log(await sooner);
const refused = new Promise((resolve, reject) => setTimeout(reject, 1, new RangeError("too late")));
console.log(await refused.catch(error => error.message));
console.log(await new Promise(resolve => setImmediate(resolve, "at once")), await new Promise(resolve => process.nextTick(resolve, "next tick")), await new Promise(resolve => queueMicrotask(resolve)));
