const subject = new EventTarget();
const result = subject.addEventListener("an", undefined, 3.5);
console.log(typeof result, result === undefined);
