const subject = new DisposableStack();
const result = subject.move();
console.log(typeof result, Object.keys(result).join());
