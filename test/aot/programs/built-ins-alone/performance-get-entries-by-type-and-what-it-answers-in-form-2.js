const subject = performance;
const result = subject.getEntriesByType("an");
console.log(Array.isArray(result), result.length);
