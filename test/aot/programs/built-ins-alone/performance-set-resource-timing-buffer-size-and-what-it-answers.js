const subject = performance;
const result = subject.setResourceTimingBufferSize(1.5);
console.log(typeof result, result === undefined);
