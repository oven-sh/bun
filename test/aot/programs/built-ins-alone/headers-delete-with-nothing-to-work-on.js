const subject = new Headers();
const result = subject.delete("an");
console.log(typeof result, result === undefined);
