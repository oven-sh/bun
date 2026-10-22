const subject = setTimeout(() => {}, 0);
const result = subject.ref(1.5, "an");
console.log(result === subject);
