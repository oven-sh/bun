const subject = setTimeout(() => {}, 0);
const result = subject.close(1.5, "an");
console.log(result === subject);
