const subject = new Headers();
const result = subject.delete(1.5);
console.log(typeof result, result === undefined);
