const subject = new EventTarget();
const result = subject.removeEventListener(1.5, null, 3.5);
console.log(typeof result, result === undefined);
