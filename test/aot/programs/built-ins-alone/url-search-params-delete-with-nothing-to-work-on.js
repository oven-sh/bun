const subject = new URLSearchParams();
const result = subject.delete("an", "-");
console.log(typeof result, result === undefined);
