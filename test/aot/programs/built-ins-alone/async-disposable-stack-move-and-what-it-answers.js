const subject = new AsyncDisposableStack();
const result = subject.move();
console.log(typeof result, Object.keys(result).join());
