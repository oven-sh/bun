const subject = performance;
const result = subject.clearMeasures("an");
console.log(typeof result, result === undefined);
