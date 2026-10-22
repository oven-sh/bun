const subject = setTimeout(() => {}, 0);
const result = subject.refresh(1.5, "an");
console.log(result === subject);
