const subject = setTimeout(() => {}, 0);
const result = subject.hasRef(1.5, "an");
console.log(typeof result);
