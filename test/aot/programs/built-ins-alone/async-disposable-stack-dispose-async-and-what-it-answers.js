const subject = new AsyncDisposableStack();
const result = subject.disposeAsync();
const settled = await result;
console.log(typeof settled, settled === undefined);
