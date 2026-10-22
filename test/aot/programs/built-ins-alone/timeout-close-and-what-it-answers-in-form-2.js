const subject = setTimeout(() => {}, 0);
const result = subject.close("an", "an");
console.log(result === subject);
