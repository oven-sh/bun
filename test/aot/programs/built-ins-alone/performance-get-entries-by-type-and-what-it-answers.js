const subject = performance;
const result = subject.getEntriesByType(1.5);
console.log(Array.isArray(result), result.length);
