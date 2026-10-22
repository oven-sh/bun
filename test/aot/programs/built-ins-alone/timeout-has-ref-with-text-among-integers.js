const subject = setTimeout(() => {}, 0);
const result = subject.hasRef("text", 1.5);
console.log(typeof result);
