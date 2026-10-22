const subject = performance;
const result = subject.getEntriesByType("text");
console.log(Array.isArray(result), result.length);
