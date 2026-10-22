const subject = setTimeout(() => {}, 0);
const result = subject.refresh("text", 1.5);
console.log(result === subject);
