const subject = performance;
const result = subject.setResourceTimingBufferSize("an");
console.log(typeof result, result === undefined);
