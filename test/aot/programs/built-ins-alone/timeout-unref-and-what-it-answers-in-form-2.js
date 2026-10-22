const subject = setTimeout(() => {}, 0);
const result = subject.unref("an", "an");
console.log(result === subject);
