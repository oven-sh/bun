const subject = performance;
const result = subject.setResourceTimingBufferSize("text");
console.log(typeof result, result === undefined);
