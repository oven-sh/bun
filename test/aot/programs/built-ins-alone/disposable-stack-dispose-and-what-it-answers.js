const subject = new DisposableStack();
const result = subject.dispose();
console.log(typeof result, result === undefined);
