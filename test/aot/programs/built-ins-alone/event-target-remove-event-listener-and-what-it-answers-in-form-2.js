const subject = new EventTarget();
const result = subject.removeEventListener("an", null, 3.5);
console.log(typeof result, result === undefined);
