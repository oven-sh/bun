const subject = setTimeout(() => {}, 0);
const result = subject.ref("an", "an");
console.log(result === subject);
