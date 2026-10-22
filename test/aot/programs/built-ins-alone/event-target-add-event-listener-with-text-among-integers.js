const subject = new EventTarget();
const result = subject.addEventListener("an", null, "text");
console.log(typeof result, result === undefined);
