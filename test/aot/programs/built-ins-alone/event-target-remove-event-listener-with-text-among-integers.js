const subject = new EventTarget();
const result = subject.removeEventListener("text", null, "text");
console.log(typeof result, result === undefined);
