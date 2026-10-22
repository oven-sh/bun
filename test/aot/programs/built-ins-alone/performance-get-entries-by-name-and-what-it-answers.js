const subject = performance;
const result = subject.getEntriesByName(1.5, 2.5);
console.log(Array.isArray(result), result.length);
