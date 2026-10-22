const subject = performance;
const result = subject.getEntriesByName("an", 2.5);
console.log(Array.isArray(result), result.length);
