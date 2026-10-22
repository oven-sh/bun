const subject = performance;
const result = subject.getEntriesByName("text", "text");
console.log(Array.isArray(result), result.length);
