const subject = performance;
const result = subject.toJSON();
console.log(typeof result, Object.keys(result).join(), typeof result.timeOrigin, typeof result.timing, Object.keys(result.timing).join());
