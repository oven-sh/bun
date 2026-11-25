// The program never names emitWarning: a timer that is set too far ahead warns by itself.
const { _eventsCount: before } = process;
clearTimeout(setTimeout(() => {}, 2 ** 40));
await new Promise(resolve => setImmediate(resolve));
const { _eventsCount: behind } = process;
console.log(before, behind);
