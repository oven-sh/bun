const subject = setTimeout(() => {}, 0);
const result = subject.hasRef("an", "an");
console.log(typeof result);
