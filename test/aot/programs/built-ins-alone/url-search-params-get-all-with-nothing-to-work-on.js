const subject = new URLSearchParams();
const result = subject.getAll("an");
console.log(Array.isArray(result), result.length);
