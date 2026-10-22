const subject = setTimeout(() => {}, 0);
const result = subject.refresh("an", "an");
console.log(result === subject);
