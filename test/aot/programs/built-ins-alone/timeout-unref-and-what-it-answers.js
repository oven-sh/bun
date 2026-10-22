const subject = setTimeout(() => {}, 0);
const result = subject.unref(1.5, "an");
console.log(result === subject);
